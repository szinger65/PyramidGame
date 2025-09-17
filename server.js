// server.js - Pyramid Card Game Multiplayer Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the game on root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for deployment platforms
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Game state storage
const games = new Map();
const playerSockets = new Map();

// Card data
const suits = ['♠', '♥', '♦', '♣'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Utility functions
function generateGameCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function createDeck() {
  const deck = [];
  for (let suit of suits) {
    for (let value of values) {
      deck.push({ suit, value });
    }
  }
  return shuffle(deck);
}

function shuffle(deck) {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

function createGame(hostId, hostName) {
  const gameCode = generateGameCode();
  const game = {
    code: gameCode,
    host: hostId,
    players: {},
    playerOrder: [],
    phase: 'lobby',
    deck: [],
    playerHands: {},
    drinkCounts: {},
    pyramidCards: [],
    currentPyramidCard: null,
    flipIndex: 0,
    currentRecallPlayer: 0
  };
  
  // Add host as first player
  game.players[hostId] = {
    id: hostId,
    name: hostName,
    isHost: true,
    connected: true
  };
  game.playerOrder.push(hostId);
  game.drinkCounts[hostId] = 0;
  
  games.set(gameCode, game);
  return game;
}

function buildPyramid(game) {
  const playerCount = game.playerOrder.length;
  const rows = playerCount < 8 ? 6 : Math.max(1, 8 - playerCount);
  
  game.pyramidCards = [];
  
  for (let row = 1; row <= rows; row++) {
    for (let i = 0; i < row; i++) {
      if (game.deck.length > 0) {
        const card = game.deck.pop();
        game.pyramidCards.push({
          ...card,
          revealed: false,
          row: row,
          position: i
        });
      }
    }
  }
}

function dealCards(game) {
  // Deal 4 cards to each player
  game.playerOrder.forEach(playerId => {
    game.playerHands[playerId] = [];
    for (let i = 0; i < 4; i++) {
      if (game.deck.length > 0) {
        game.playerHands[playerId].push(game.deck.pop());
      }
    }
  });
}

function broadcastToGame(gameCode, event, data) {
  const game = games.get(gameCode);
  if (!game) return;
  
  game.playerOrder.forEach(playerId => {
    const socket = playerSockets.get(playerId);
    if (socket) {
      socket.emit(event, data);
    }
  });
}

function getGameState(game) {
  return {
    phase: game.phase,
    playerNames: game.playerOrder.map(id => game.players[id].name),
    players: game.playerOrder,
    playerHands: game.playerHands,
    drinkCounts: game.drinkCounts,
    pyramidCards: game.pyramidCards,
    currentPyramidCard: game.currentPyramidCard,
    flipIndex: game.flipIndex
  };
}

function parseRecalledCards(recalledString) {
  // Parse string like "A 5 K 2" or "Ace 5 King 2" into standardized array
  const normalizedInput = recalledString.toUpperCase().trim();
  
  // Split by spaces and clean up
  const parts = normalizedInput.split(/[\s,]+/).filter(part => part.length > 0);
  
  const standardizedCards = parts.map(part => {
    // Convert word forms to standard values
    const cardMap = {
      'ACE': 'A', 'A': 'A',
      'KING': 'K', 'K': 'K',
      'QUEEN': 'Q', 'Q': 'Q', 
      'JACK': 'J', 'J': 'J',
      '10': '10', 'TEN': '10',
      '2': '2', 'TWO': '2',
      '3': '3', 'THREE': '3',
      '4': '4', 'FOUR': '4',
      '5': '5', 'FIVE': '5',
      '6': '6', 'SIX': '6',
      '7': '7', 'SEVEN': '7',
      '8': '8', 'EIGHT': '8',
      '9': '9', 'NINE': '9'
    };
    
    return cardMap[part] || part;
  });
  
  return standardizedCards.filter(card => card); // Remove any undefined values
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('hostGame', (data) => {
    try {
      const game = createGame(socket.id, data.playerName);
      playerSockets.set(socket.id, socket);
      
      socket.join(game.code);
      socket.emit('gameCreated', {
        gameCode: game.code,
        playerId: socket.id,
        players: game.players
      });
      
      console.log(`Game created: ${game.code} by ${data.playerName}`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to create game' });
    }
  });

  socket.on('joinGame', (data) => {
    try {
      const game = games.get(data.gameCode);
      
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }
      
      if (game.playerOrder.length >= 7) {
        socket.emit('error', { message: 'Game is full (max 7 players)' });
        return;
      }
      
      if (game.phase !== 'lobby') {
        socket.emit('error', { message: 'Game already started' });
        return;
      }
      
      // Add player to game
      game.players[socket.id] = {
        id: socket.id,
        name: data.playerName,
        isHost: false,
        connected: true
      };
      game.playerOrder.push(socket.id);
      game.drinkCounts[socket.id] = 0;
      
      playerSockets.set(socket.id, socket);
      socket.join(data.gameCode);
      
      socket.emit('gameJoined', {
        gameCode: data.gameCode,
        playerId: socket.id,
        players: game.players
      });
      
      // Notify other players
      socket.to(data.gameCode).emit('playerJoined', {
        playerId: socket.id,
        player: game.players[socket.id]
      });
      
      console.log(`${data.playerName} joined game ${data.gameCode}`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('startGame', (data) => {
    try {
      const game = games.get(data.gameCode);
      
      if (!game || game.host !== socket.id) {
        socket.emit('error', { message: 'Only host can start game' });
        return;
      }
      
      if (game.playerOrder.length < 3) {
        socket.emit('error', { message: 'Need at least 3 players' });
        return;
      }
      
      // Initialize game
      game.phase = 'setup';
      game.deck = createDeck();
      
      // Notify all players
      broadcastToGame(data.gameCode, 'gameStarted', {
        gameState: getGameState(game)
      });
      
      console.log(`Game ${data.gameCode} started with ${game.playerOrder.length} players`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  socket.on('gameAction', (data) => {
    try {
      const game = games.get(data.gameCode);
      
      if (!game || game.host !== socket.id) {
        socket.emit('error', { message: 'Only host can control game' });
        return;
      }
      
      switch (data.action) {
        case 'autoStart':
          // Deal cards and build pyramid
          dealCards(game);
          buildPyramid(game);
          game.phase = 'dealt';
          break;
          
        case 'startMemorize':
          game.phase = 'memorize';
          // Start 30 second timer (handled client-side)
          setTimeout(() => {
            if (game.phase === 'memorize') {
              game.phase = 'pyramid';
              broadcastToGame(data.gameCode, 'gameStateUpdate', {
                gameState: getGameState(game)
              });
            }
          }, 30000);
          break;
          
        case 'flipPyramidCard':
          if (game.flipIndex < game.pyramidCards.length) {
            game.pyramidCards[game.flipIndex].revealed = true;
            const card = game.pyramidCards[game.flipIndex];
            game.currentPyramidCard = `${card.value}${card.suit}`;
            game.flipIndex++;
            
            // Check if all pyramid cards are flipped
            if (game.flipIndex >= game.pyramidCards.length) {
              game.phase = 'recall';
              // Start card recall phase
              setTimeout(() => {
                broadcastToGame(data.gameCode, 'startCardRecall', {});
              }, 1000);
            }
          }
          break;

        case 'finishGame':
          game.phase = 'finished';
          game.currentRecallPlayer = 0;
          break;
          
        case 'restartGame':
          // Reset game state
          game.phase = 'setup';
          game.deck = createDeck();
          game.playerHands = {};
          game.drinkCounts = {};
          game.pyramidCards = [];
          game.currentPyramidCard = null;
          game.flipIndex = 0;
          game.currentRecallPlayer = 0;
          
          // Reset drink counts
          game.playerOrder.forEach(playerId => {
            game.drinkCounts[playerId] = 0;
          });
          break;
      }
      
      // Broadcast updated state
      broadcastToGame(data.gameCode, 'gameStateUpdate', {
        gameState: getGameState(game)
      });
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to process game action' });
    }
  });

  socket.on('challenge', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game) return;
      
      // Broadcast challenge to target player
      const targetSocket = playerSockets.get(data.targetId);
      if (targetSocket) {
        targetSocket.emit('challengeReceived', {
          challengerId: data.challengerId,
          targetId: data.targetId
        });
      }
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to send challenge' });
    }
  });

  socket.on('challengeResponse', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game) return;
      
      const challengerId = data.challengerId;
      const targetId = data.targetId;
      const challengerName = game.players[challengerId]?.name || 'Unknown';
      const targetName = game.players[targetId]?.name || 'Unknown';
      
      if (data.response === 'accept') {
        // Target accepts drink
        game.drinkCounts[targetId] = (game.drinkCounts[targetId] || 0) + 1;
        
        // Send targeted messages
        const targetSocket = playerSockets.get(challengerId);
        const challengerSocket = playerSockets.get(targetId);
        
        if (targetSocket) {
          targetSocket.emit('challengeResult', {
            message: `${targetName} takes the drink! 🍺`,
            flipCard: false
          });
        }
        
        if (challengerSocket) {
          challengerSocket.emit('challengeResult', {
            message: `You take a drink! 🍺`,
            flipCard: false
          });
        }
        
        // Broadcast to others
        game.playerOrder.forEach(playerId => {
          if (playerId !== challengerId && playerId !== targetId) {
            const socket = playerSockets.get(playerId);
            if (socket) {
              socket.emit('challengeResult', {
                message: `${targetName} takes a drink! 🍺`,
                flipCard: false
              });
            }
          }
        });
        
      } else if (data.response === 'challenge') {
        // Target calls bluff - challenger must prove they have the card
        const cardValue = game.currentPyramidCard.replace(/[♠♥♦♣]/g, '');
        
        // Send targeted messages
        const targetSocket = playerSockets.get(challengerId);
        const challengerSocket = playerSockets.get(targetId);
        
        if (targetSocket) {
          targetSocket.emit('challengeResult', {
            message: `${targetName} calls your bluff! Prove you have ${cardValue} or drink!`,
            needsCardFlip: true,
            cardValue: cardValue,
            challengerId: challengerId
          });
        }
        
        if (challengerSocket) {
          challengerSocket.emit('challengeResult', {
            message: `You called ${challengerName}'s bluff!`,
            flipCard: false
          });
        }
        
        // Broadcast to others
        game.playerOrder.forEach(playerId => {
          if (playerId !== challengerId && playerId !== targetId) {
            const socket = playerSockets.get(playerId);
            if (socket) {
              socket.emit('challengeResult', {
                message: `${targetName} calls ${challengerName}'s bluff!`,
                flipCard: false
              });
            }
          }
        });
      }
      
      // Update game state
      broadcastToGame(data.gameCode, 'gameStateUpdate', {
        gameState: getGameState(game)
      });
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to process challenge response' });
    }
  });

  socket.on('proveCard', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game) return;
      
      const challengerId = socket.id;
      const challengerName = game.players[challengerId]?.name || 'Unknown';
      
      if (data.proved) {
        // Challenger successfully proved they have the card
        // Find the target who called the bluff (this is stored in a temporary state)
        // For now, we'll broadcast success
        broadcastToGame(data.gameCode, 'challengeResult', {
          message: `${challengerName} proves they have ${data.cardValue}! Target drinks twice! 🍺🍺`,
          flipCard: true,
          challengerId: challengerId,
          cardValue: data.cardValue
        });
        
        // The target should drink twice - this needs to be handled client-side
        // since we don't store the temporary bluff state
        
      } else {
        // Challenger admits they were bluffing
        game.drinkCounts[challengerId] = (game.drinkCounts[challengerId] || 0) + 1;
        
        broadcastToGame(data.gameCode, 'challengeResult', {
          message: `${challengerName} was bluffing! They drink instead! 🍺`,
          flipCard: false
        });
      }
      
      // Update game state
      broadcastToGame(data.gameCode, 'gameStateUpdate', {
        gameState: getGameState(game)
      });
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to process card proof' });
    }
  });

  socket.on('verifyCardRecall', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game) return;
      
      const playerId = data.playerId;
      const playerName = game.players[playerId]?.name || 'Unknown';
      const actualCards = game.playerHands[playerId] || [];
      const recalledCards = data.recalledCards;
      
      // Compare only card values, not suits
      const actualCardValues = actualCards.map(card => card.value);
      const recalledCardValues = parseRecalledCards(recalledCards);
      
      const correct = recalledCardValues.length === 4 && arraysEqual(actualCardValues.sort(), recalledCardValues.sort());
      
      if (!correct) {
        // Player got it wrong - add penalty drinks
        game.drinkCounts[playerId] = (game.drinkCounts[playerId] || 0) + 5;
      }
      
      // Broadcast result
      broadcastToGame(data.gameCode, 'cardRecallResult', {
        playerId: playerId,
        playerName: playerName,
        correct: correct,
        nextPlayerIndex: data.playerIndex + 1
      });
      
      // Update game state
      broadcastToGame(data.gameCode, 'gameStateUpdate', {
        gameState: getGameState(game)
      });
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to verify card recall' });
    }
  });
    console.log(`Player disconnected: ${socket.id}`);
    
    // Find and update games
    for (let [gameCode, game] of games.entries()) {
      if (game.players[socket.id]) {
        if (game.host === socket.id) {
          // Host disconnected - end game or transfer host
          if (game.playerOrder.length > 1) {
            // Transfer host to next player
            const nextHost = game.playerOrder.find(id => id !== socket.id);
            if (nextHost) {
              game.host = nextHost;
              game.players[nextHost].isHost = true;
            }
          } else {
            // Last player - delete game
            games.delete(gameCode);
            playerSockets.delete(socket.id);
            return;
          }
        }
        
        // Remove player
        delete game.players[socket.id];
        game.playerOrder = game.playerOrder.filter(id => id !== socket.id);
        
        // Notify remaining players
        socket.to(gameCode).emit('playerLeft', {
          playerId: socket.id
        });
        
        playerSockets.delete(socket.id);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Pyramid Card Game server running on port ${PORT}`);
  console.log(`Players can connect at http://localhost:${PORT}`);
});

// Cleanup old games periodically
setInterval(() => {
  const now = Date.now();
  for (let [gameCode, game] of games.entries()) {
    const connectedPlayers = game.playerOrder.filter(id => 
      playerSockets.has(id) && playerSockets.get(id).connected
    );
    
    if (connectedPlayers.length === 0) {
      console.log(`Cleaning up empty game: ${gameCode}`);
      games.delete(gameCode);
    }
  }
}, 300000); // Clean up every 5 minutes

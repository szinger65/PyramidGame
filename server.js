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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const games = new Map();
const playerSockets = new Map();

const suits = ['♠', '♥', '♦', '♣'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

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
    currentRecallPlayer: 0,
    activeBluff: null
  };
  
  game.players[hostId] = { id: hostId, name: hostName, isHost: true, connected: true };
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
        game.pyramidCards.push({ ...card, revealed: false, row: row, position: i });
      }
    }
  }
}

function dealCards(game) {
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
  io.to(gameCode).emit(event, data);
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
  const normalizedInput = recalledString.toUpperCase().trim();
  const parts = normalizedInput.split(/[\s,]+/).filter(part => part.length > 0);
  const cardMap = { 'ACE':'A','A':'A','KING':'K','K':'K','QUEEN':'Q','Q':'Q','JACK':'J','J':'J','10':'10','TEN':'10','2':'2','TWO':'2','3':'3','THREE':'3','4':'4','FOUR':'4','5':'5','FIVE':'5','6':'6','SIX':'6','7':'7','SEVEN':'7','8':'8','EIGHT':'8','9':'9','NINE':'9' };
  return parts.map(part => cardMap[part] || part).filter(card => card);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('hostGame', (data) => {
    try {
      const game = createGame(socket.id, data.playerName);
      playerSockets.set(socket.id, socket);
      socket.join(game.code);
      socket.emit('gameCreated', { gameCode: game.code, playerId: socket.id, players: game.players });
      console.log(`Game created: ${game.code} by ${data.playerName}`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to create game' });
    }
  });

  socket.on('joinGame', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game) return socket.emit('error', { message: 'Game not found' });
      if (game.playerOrder.length >= 7) return socket.emit('error', { message: 'Game is full' });
      if (game.phase !== 'lobby') return socket.emit('error', { message: 'Game already started' });
      
      game.players[socket.id] = { id: socket.id, name: data.playerName, isHost: false, connected: true };
      game.playerOrder.push(socket.id);
      game.drinkCounts[socket.id] = 0;
      playerSockets.set(socket.id, socket);
      socket.join(data.gameCode);
      
      // Notify the joining player that they succeeded
      socket.emit('gameJoined', { gameCode: data.gameCode, playerId: socket.id, players: game.players });
      
      // *** THE FIX IS HERE ***
      // Notify EVERYONE in the room (including the new player) with the complete list of players.
      broadcastToGame(data.gameCode, 'playerJoined', { players: game.players });
      
      console.log(`${data.playerName} joined game ${data.gameCode}`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('startGame', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game || game.host !== socket.id) return socket.emit('error', { message: 'Only host can start' });
      if (game.playerOrder.length < 3) return socket.emit('error', { message: 'Need at least 3 players' });
      
      game.phase = 'setup';
      game.deck = createDeck();
      
      broadcastToGame(data.gameCode, 'gameStarted', { gameState: getGameState(game) });
      console.log(`Game ${data.gameCode} started`);
    } catch (error) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  socket.on('gameAction', (data) => {
    try {
      const game = games.get(data.gameCode);
      if (!game || game.host !== socket.id) return;
      
      switch (data.action) {
        case 'autoStart':
          dealCards(game);
          buildPyramid(game);
          game.phase = 'dealt';
          break;
        case 'startMemorize':
          game.phase = 'memorize';
          setTimeout(() => {
            if (game.phase === 'memorize') {
              game.phase = 'pyramid';
              broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
            }
          }, 30000);
          break;
        case 'flipPyramidCard':
          if (game.flipIndex < game.pyramidCards.length) {
            game.pyramidCards[game.flipIndex].revealed = true;
            const card = game.pyramidCards[game.flipIndex];
            game.currentPyramidCard = `${card.value}${card.suit}`;
            game.flipIndex++;
            if (game.flipIndex >= game.pyramidCards.length) {
              game.phase = 'recall';
              setTimeout(() => broadcastToGame(data.gameCode, 'startCardRecall', {}), 1000);
            }
          }
          break;
        case 'finishGame':
          game.phase = 'finished';
          break;
        case 'restartGame':
          game.phase = 'setup';
          game.deck = createDeck();
          game.playerHands = {};
          game.pyramidCards = [];
          game.currentPyramidCard = null;
          game.flipIndex = 0;
          game.playerOrder.forEach(pId => { game.drinkCounts[pId] = 0; });
          break;
      }
      broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
    } catch (error) {
      socket.emit('error', { message: 'Failed to process action' });
    }
  });

  socket.on('challenge', (data) => {
    const game = games.get(data.gameCode);
    if (!game) return;
    game.activeBluff = { challengerId: data.challengerId, targetId: data.targetId };
    broadcastToGame(data.gameCode, 'challengeReceived', data);
  });

  socket.on('challengeResponse', (data) => {
    const game = games.get(data.gameCode);
    if (!game || !game.activeBluff) return;

    const { challengerId, targetId } = game.activeBluff;
    const challengerName = game.players[challengerId]?.name;
    const targetName = game.players[targetId]?.name;

    if (data.response === 'accept') {
      game.drinkCounts[targetId]++;
      broadcastToGame(data.gameCode, 'challengeResult', {
        message: `${targetName} takes the drink! 🍺`
      });
    } else if (data.response === 'challenge') {
      broadcastToGame(data.gameCode, 'challengeResult', {
        message: `${targetName} calls ${challengerName}'s bluff!`
      });

      const cardValue = game.currentPyramidCard.replace(/[♠♥♦♣]/g, '');
      const challengerSocket = playerSockets.get(challengerId);
      if (challengerSocket) {
        challengerSocket.emit('proveYourCard', { cardValue });
      }
    }
    
    game.activeBluff = null;
    broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
  });

  socket.on('proveCard', (data) => {
    const game = games.get(data.gameCode);
    if (!game) return;
    
    const challengerId = socket.id;
    const challengerName = game.players[challengerId]?.name;
    const targetId = Object.keys(game.players).find(pId => pId !== challengerId && game.activeBluff?.targetId === pId);
    const targetName = game.players[targetId]?.name || 'The target';

    const hasCard = game.playerHands[challengerId].some(c => c.value === data.cardValue);

    if (hasCard) {
      broadcastToGame(data.gameCode, 'challengeResult', {
        message: `${challengerName} proves they have the card! ${targetName} drinks twice! 🍺🍺`,
        reveal: { playerId: challengerId, cardValue: data.cardValue }
      });
      if(targetId) game.drinkCounts[targetId] += 2;
    } else {
      broadcastToGame(data.gameCode, 'challengeResult', {
        message: `${challengerName} was bluffing! They drink! 🍺`
      });
      game.drinkCounts[challengerId]++;
    }
    
    broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
  });

  socket.on('verifyCardRecall', (data) => {
    const game = games.get(data.gameCode);
    if (!game) return;

    const { playerId, playerIndex } = data;
    const actualCardValues = (game.playerHands[playerId] || []).map(c => c.value);
    const recalledCardValues = parseRecalledCards(data.recalledCards);
    const correct = arraysEqual(actualCardValues.sort(), recalledCardValues.sort());

    if (!correct) {
      game.drinkCounts[playerId] = (game.drinkCounts[playerId] || 0) + 5;
    }

    broadcastToGame(data.gameCode, 'cardRecallResult', {
      playerName: game.players[playerId]?.name,
      correct,
      nextPlayerIndex: playerIndex + 1
    });

    if (playerIndex + 1 >= game.playerOrder.length) {
      game.phase = 'finished';
      setTimeout(() => {
        broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
      }, 3000);
    }
    
    broadcastToGame(data.gameCode, 'gameStateUpdate', { gameState: getGameState(game) });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    for (let [gameCode, game] of games.entries()) {
      if (game.players[socket.id]) {
        if (game.host === socket.id && game.playerOrder.length > 1) {
          const nextHostId = game.playerOrder.find(id => id !== socket.id);
          game.host = nextHostId;
          if(game.players[nextHostId]) game.players[nextHostId].isHost = true;
        }
        delete game.players[socket.id];
        game.playerOrder = game.playerOrder.filter(id => id !== socket.id);
        
        if (game.playerOrder.length === 0) {
          games.delete(gameCode);
        } else {
          broadcastToGame(gameCode, 'playerLeft', { players: game.players });
        }
        break;
      }
    }
    playerSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Pyramid Card Game server running on port ${PORT}`);
});```

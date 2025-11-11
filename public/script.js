let socket = null;
        let gameCode = null;
        let playerId = null;
        let isHost = false;
        let gameState = {};
        let connectedPlayers = {};
        let players = [];
        let playerHands = {};
        let playerNames = [];
        let myPlayerId = null;
        let memorizeTimer = null;

        function initSocket() {
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const socketUrl = isLocal ? 'http://localhost:3000' : undefined;
            socket = io(socketUrl);

            socket.on('connect', () => updateConnectionStatus(true));
            socket.on('disconnect', () => updateConnectionStatus(false));
            
            socket.on('error', (err) => {
                showGameMessage(err.message);
                document.getElementById('host-btn').disabled = false;
                document.getElementById('join-btn').disabled = false;
            });

            socket.on('gameCreated', (data) => {
                gameCode = data.gameCode;
                playerId = data.playerId;
                isHost = true;
                document.getElementById('host-game-code').textContent = gameCode;
                document.getElementById('host-info').style.display = 'block';
                updatePlayersList(data.players);
            });

            socket.on('gameJoined', (data) => {
                gameCode = data.gameCode;
                playerId = data.playerId;
                isHost = false;
                document.getElementById('join-info').style.display = 'block';
                updatePlayersList(data.players);
            });

            socket.on('playerJoined', (data) => updatePlayersList(data.players));
            socket.on('playerLeft', (data) => updatePlayersList(data.players));
            
            socket.on('gameStarted', (data) => {
                gameState = data.gameState;
                startMultiplayerGame();
            });

            socket.on('gameStateUpdate', (data) => {
                gameState = data.gameState;
                updateGameFromState();
            });

            socket.on('challengeReceived', (data) => receiveChallenge(data));
            socket.on('cardRecallResult', (data) => handleCardRecallResult(data));
            
            socket.on('challengeResult', (data) => {
                showGameMessage(data.message, 4000);
                if (data.reveal) {
                    flipPlayerCard(data.reveal.playerId, data.reveal.cardValue);
                }
            });

            socket.on('proveYourCard', (data) => showCardFlipModal(data.cardValue));
            socket.on('beginRecallTurn', (data) => showCardRecallInput(data.playerIndex));
                socket.on('newChatMessage', (data) => {
                        const messagesContainer = document.getElementById('chat-messages');
                        const messageElement = document.createElement('div');
                        messageElement.classList.add('chat-message');
                        
                        const senderSpan = document.createElement('span');
                        senderSpan.classList.add('sender-name');
                        senderSpan.textContent = data.sender;
                        
                        messageElement.appendChild(senderSpan);
                        messageElement.append(data.message);
                        
                        messagesContainer.prepend(messageElement);
                    });
                }

        function showMenuScreen() {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById('menu-screen').classList.add('active');
        }

        function showHostScreen() {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById('host-screen').classList.add('active');
        }

        function showJoinScreen() {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById('join-screen').classList.add('active');
        }

        function hostGame() {
            const hostName = document.getElementById('host-name').value.trim() || 'Host';
            if (!socket || !socket.connected) {
                return showGameMessage('Connecting...');
            }
            socket.emit('hostGame', { playerName: hostName });
            document.getElementById('host-btn').disabled = true;
        }

        function joinGame() {
            const playerName = document.getElementById('join-name').value.trim() || 'Player';
            const code = document.getElementById('game-code-input').value.trim().toUpperCase();
            
            if (!code) {
                return showGameMessage('Please enter a game code');
            }
            if (!socket || !socket.connected) {
                return showGameMessage('Connecting...');
            }
            
            socket.emit('joinGame', { gameCode: code, playerName: playerName });
            document.getElementById('join-btn').disabled = true;
        }

        function startHostedGame() {
            if (Object.keys(connectedPlayers).length < 3) {
                return showGameMessage('Need at least 3 players');
            }
            socket.emit('startGame', { gameCode });
        }

        function updateConnectionStatus(connected) {
            const status = document.getElementById('connection-status');
            status.textContent = connected ? 'Connected' : 'Disconnected';
            status.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
        }

        function updatePlayersList(serverPlayers) {
            connectedPlayers = serverPlayers;
            const playerCount = Object.keys(connectedPlayers).length;
            const startBtn = document.getElementById('start-game-btn');
            
            if (startBtn) {
                startBtn.disabled = playerCount < 3;
                startBtn.textContent = playerCount < 3 ? 
                    `Need ${3 - playerCount} more player(s)` : 
                    `Start Game (${playerCount} players)`;
            }
            
            ['host-players-list', 'join-players-list'].forEach(listId => {
                const list = document.getElementById(listId);
                if (list) {
                    list.innerHTML = '';
                    Object.values(connectedPlayers).forEach(p => {
                        const item = document.createElement('div');
                        item.className = 'player-item';
                        if (p.isHost) item.classList.add('is-host');
                        if (p.id === playerId) item.classList.add('is-you');
                        
                        item.innerHTML = `
                            <span>
                                ${p.name} 
                                ${p.isHost ? '👑' : ''} 
                                ${p.id === playerId ? '(You)' : ''}
                            </span>
                            <div class="status-indicator"></div>
                        `;
                        list.appendChild(item);
                    });
                }
            });
        }

        function startMultiplayerGame() {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById('game-screen').classList.add('active');
            myPlayerId = playerId;
            updateGameFromState();
        }

        function setupGameTable() {
            const container = document.getElementById('table-container');
            container.innerHTML = `
                <div id="table">
                    <div id="pyramid" class="pyramid"></div>
                </div>
            `;
            
            const radius = 350; 
            const centerX = container.offsetWidth / 2;
            const centerY = container.offsetHeight / 2;
            const angleStep = 360 / players.length;
            const angleOffset = (players.length % 2 === 0) ? angleStep / 2 : 0;
            
            players.forEach((pId, i) => {
                const angle = (angleStep * i + angleOffset) * Math.PI / 180 - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                
                let y;
                if (players.length % 2 !== 0) {
                    y = (centerY + radius * Math.sin(angle)) + 20;
                } else {
                    y = centerY + radius * Math.sin(angle);
                }

                const el = document.createElement('div');
                el.className = 'player';
                el.id = pId;
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
                el.style.transform = 'translate(-50%, -50%)';
                
                if (pId === myPlayerId) el.classList.add('current-user');
                if (connectedPlayers[pId]?.isHost) el.classList.add('is-host');
                
                el.innerHTML = `
                    <div class="player-header">
                        <div class="player-name">${playerNames[i]}</div>
                        <div class="drink-counter" id="drinks-${pId}">Drinks: 0</div>
                    </div>
                    <div class="player-cards" id="cards-${pId}"></div>
                    <div class="player-actions" id="actions-${pId}" style="display:none;"></div>
                `;
                container.appendChild(el);
            });
        }

        function showGameMessage(msg, dur = 3000) {
            const el = document.getElementById('game-message');
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', dur);
        }

        function autoStart() {
            if (isHost) {
                socket.emit('gameAction', { gameCode, action: 'autoStart' });
            }
        }

        function startMemorizePhase() {
            if (isHost) {
                socket.emit('gameAction', { gameCode, action: 'startMemorize' });
            }
        }

        function nextPyramidCard() {
            if (isHost) {
                socket.emit('gameAction', { gameCode, action: 'flipPyramidCard' });
            }
        }

        function startRecall() {
            if (isHost) {
                socket.emit('gameAction', { gameCode, action: 'startRecall' });
            }
        }

        function showCardFlipModal(requiredCardValue) {
            const prompt = document.getElementById('prove-card-prompt');
            const myCardElements = document.querySelectorAll(`#${myPlayerId} .card`);
            const myHandData = playerHands[myPlayerId] || [];

            const matchingCardIndexes = [];
            myHandData.forEach((card, index) => {
                if (card.value === requiredCardValue) {
                    matchingCardIndexes.push(index);
                }
            });

            const requiredClicks = matchingCardIndexes.length;
            let clicksMade = 0;

            const cleanup = () => {
                prompt.style.display = 'none';
                myCardElements.forEach(c => {
                    c.style.cursor = 'default';
                    c.onclick = null;
                });
            };
            
            if (requiredClicks === 0) {
                prompt.innerHTML = `<strong>You don't have any ${requiredCardValue}s!</strong><br><button>Admit Bluff</button>`;
                prompt.style.display = 'block';
                prompt.querySelector('button').onclick = () => {
                    cleanup();
                    socket.emit('proveCard', { gameCode, cardValue: requiredCardValue, proved: false });
                };
                return;
            }

            prompt.innerHTML = `<strong>Prove you have all ${requiredClicks} of your ${requiredCardValue}s!</strong> (${clicksMade}/${requiredClicks})<br><button>Admit Bluff</button>`;
            prompt.style.display = 'block';
            prompt.querySelector('button').onclick = () => {
                cleanup();
                socket.emit('proveCard', { gameCode, cardValue: requiredCardValue, proved: false });
            };

            myCardElements.forEach((cardEl, i) => {
                cardEl.style.cursor = 'pointer';
                cardEl.onclick = () => {
                    if (matchingCardIndexes.includes(i)) {
                        cardEl.classList.add('flipped');
                        cardEl.style.cursor = 'default';
                        cardEl.onclick = null;
                        clicksMade++;
                        prompt.innerHTML = `<strong>Prove you have all ${requiredClicks} of your ${requiredCardValue}s!</strong> (${clicksMade}/${requiredClicks})<br><button>Admit Bluff</button>`;

                        if (clicksMade === requiredClicks) {
                            setTimeout(() => {
                                cleanup();
                                socket.emit('proveCard', { gameCode, cardValue: requiredCardValue, proved: true });
                            }, 700);
                        }
                    } else {
                        cardEl.classList.add('flipped');
                        setTimeout(() => {
                            cleanup();
                            socket.emit('proveCard', { gameCode, cardValue: requiredCardValue, proved: false });
                        }, 700);
                    }
                };
            });
        }

        function flipPlayerCard(pId, cardValue) {
            const pCards = document.querySelectorAll(`#${pId} .card`);
            const pHand = playerHands[pId] || [];
            
            for (let i = 0; i < pHand.length; i++) {
                if (pHand[i].value === cardValue && !pCards[i].classList.contains('flipped')) {
                    setTimeout(() => pCards[i].classList.add('flipped'), 10);
                    break;
                }
            }
        }

        function showCardRecallInput(playerIndex) {
            if (players[playerIndex] === myPlayerId) {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="modal-content">
                        <h3>Recite your cards!</h3>
                        <p>Enter values (e.g., "A 5 K 2"):</p>
                        <input type="text" id="card-recall-input" style="width: 80%;">
                        <div class="modal-buttons">
                            <button class="challenge-btn">Submit</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                
                const input = modal.querySelector('#card-recall-input');
                input.focus();
                
                modal.querySelector('.challenge-btn').onclick = () => {
                    if (!input.value.trim()) {
                        return showGameMessage('Please enter cards');
                    }
                    socket.emit('verifyCardRecall', { gameCode, playerId, recalledCards: input.value });
                    modal.remove();
                };
            } else {
                showGameMessage(`${playerNames[playerIndex]} is reciting their cards...`);
            }
        }

        function handleCardRecallResult(data) {
            const message = data.correct ? 
                `${data.playerName} was correct!` : 
                `${data.playerName} was wrong!`;
            showGameMessage(message, 2500);
        }
        
        function makeSomeoneDrink() {
            if (!gameState.currentPyramidCard) {
                return showGameMessage("Wait for a card!");
            }
            
            const modal = document.getElementById('target-modal');
            const buttons = document.getElementById('target-buttons');
            buttons.innerHTML = '';
            
            players.filter(p => p !== myPlayerId).forEach(targetId => {
                const btn = document.createElement('button');
                btn.className = 'target-player-btn';
                btn.textContent = playerNames[players.indexOf(targetId)];
                btn.onclick = () => {
                    socket.emit('challenge', { gameCode, challengerId: myPlayerId, targetId });
                    modal.style.display = 'none';
                };
                buttons.appendChild(btn);
            });
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'cancel-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => modal.style.display = 'none';
            buttons.appendChild(cancelBtn);
            
            modal.style.display = 'flex';
        }

        function receiveChallenge(data) {
            if (data.targetId === myPlayerId) {
                const challengerName = playerNames[players.indexOf(data.challengerId)];
                document.getElementById('bluff-message').textContent = `${challengerName} says you drink!`;
                document.getElementById('bluff-modal').style.display = 'flex';
            }
        }
        
        function acceptDrink() {
            document.getElementById('bluff-modal').style.display = 'none';
            socket.emit('challengeResponse', { gameCode, response: 'accept' });
        }

        function callBluff() {
            document.getElementById('bluff-modal').style.display = 'none';
            socket.emit('challengeResponse', { gameCode, response: 'challenge' });
        }

        function updateGameFromState() {
            if (!gameState || !gameState.players) return;
            
            players = gameState.players;
            playerNames = gameState.playerNames;
            
            if (gameState.phase === 'setup' || document.querySelectorAll('.player').length !== players.length) {
                setupGameTable();
            }

            Object.entries(gameState.playerHands || {}).forEach(([pId, cards]) => {
                playerHands[pId] = cards;
                updatePlayerCardsDisplay(pId, cards);
            });

            Object.entries(gameState.drinkCounts || {}).forEach(([pId, count]) => {
                const drinkEl = document.getElementById(`drinks-${pId}`);
                if (drinkEl) {
                    drinkEl.textContent = `Drinks: ${count}`;
                }
            });

            updatePyramidFromState(gameState.pyramidCards || []);
            
            if (gameState.currentPyramidCard) {
                document.getElementById('current-card').textContent = gameState.currentPyramidCard;
            }
            
            showPlayerActions(gameState.phase === 'pyramid');
            updateGameStatus(gameState.phase);
        }
        function updatePlayerCardsDisplay(pId, cards) {
            const container = document.getElementById(`cards-${pId}`);
            if (!container) return;
            
            container.innerHTML = '';
            cards.forEach(card => container.appendChild(createCardElement(card)));
        }
        function createCardElement(card) {
            const el = document.createElement('div');
            el.className = 'card';
            
            const cardInner = document.createElement('div');
            cardInner.className = 'card-inner';
            
            const cardFront = document.createElement('div');
            cardFront.className = 'card-front';
            
            const valueMap = {
                'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5',
                '6': '6', '7': '7', '8': '8', '9': '9', '10': '10',
                'J': 'J', 'Q': 'Q', 'K': 'K'
            };
            
            const suitMap = {
                '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C'
            };
            
            const cardCode = `${valueMap[card.value]}${suitMap[card.suit]}`;
            cardFront.style.backgroundImage = `url('https://deckofcardsapi.com/static/img/${cardCode}.png')`;
            
            const cardBack = document.createElement('div');
            cardBack.className = 'card-back';

            cardInner.appendChild(cardFront);
            cardInner.appendChild(cardBack);
            el.appendChild(cardInner);
            
            return el;
        }
        function updatePyramidFromState(pyramidData) {
            const container = document.getElementById('pyramid');
            if (!container) return;
            
            if (!container.hasChildNodes() || pyramidData.length === 0) {
                container.innerHTML = '';
                let cardIndex = 0;
                
                for (let rows = 1; cardIndex < pyramidData.length; rows++) {
                    const rowEl = document.createElement('div');
                    rowEl.className = 'row';
                    
                    for (let i = 0; i < rows && cardIndex < pyramidData.length; i++, cardIndex++) {
                        const card = createCardElement(pyramidData[cardIndex]);
                        if (pyramidData[cardIndex].revealed) {
                            card.classList.add('flipped');
                        }
                        rowEl.appendChild(card);
                    }
                    container.appendChild(rowEl);
                }
            } else {
                pyramidData.forEach((cardData, index) => {
                    if (cardData.revealed) {
                        const cardEl = container.querySelectorAll('.card')[index];
                        if (cardEl && !cardEl.classList.contains('flipped')) {
                            setTimeout(() => cardEl.classList.add('flipped'), 10);
                        }
                    }
                });
            }
        }
        function updateGameStatus(phase) {
            const controls = {
                phaseDisplay: document.getElementById('phase-display'),
                currentTurn: document.getElementById('current-turn'),
                timerDisplay: document.getElementById('timer-display'),
                currentCardDisplay: document.getElementById('current-card-display')
            };

            const buttons = {
                autoStart: document.getElementById('auto-start-btn'),
                memorize: document.getElementById('memorize-btn'),
                pyramid: document.getElementById('pyramid-btn'),
                recall: document.getElementById('recall-btn')
            };

            Object.values(buttons).forEach(btn => btn.style.display = 'none');
            
            const restartBtn = document.getElementById('restart-btn');
            if (restartBtn) {
                restartBtn.remove();
            }

            const allPyramidCardsFlipped = gameState.pyramidCards && 
                gameState.pyramidCards.every(c => c.revealed);
            controls.timerDisplay.style.display = 'none';

            switch (phase) {
                case 'setup':
                    controls.phaseDisplay.textContent = 'Phase: Ready';
                    controls.currentTurn.textContent = 'Ready to Start!';
                    if (isHost) buttons.autoStart.style.display = 'block';
                    break;

                case 'dealt':
                    controls.phaseDisplay.textContent = 'Phase: Memorize';
                    controls.currentTurn.textContent = 'Cards Dealt!';
                    if (isHost) buttons.memorize.style.display = 'block';
                    break;

                case 'memorize':
                    controls.phaseDisplay.textContent = 'Phase: MEMORIZE!';
                    controls.currentTurn.textContent = 'Memorize!';
                    controls.timerDisplay.style.display = 'block';
                    startLocalMemorizePhase();
                    break;

                case 'pyramid':
                    controls.phaseDisplay.textContent = 'Phase: Pyramid';
                    controls.currentTurn.textContent = 'Pyramid';
                    if (isHost && !allPyramidCardsFlipped) {
                        buttons.pyramid.style.display = 'block';
                    }
                    if (isHost && allPyramidCardsFlipped) {
                        buttons.recall.style.display = 'block';
                    }
                    break;

                case 'recall':
                    controls.phaseDisplay.textContent = 'Phase: Recall';
                    controls.currentTurn.textContent = 'Recall Cards!';
                    break;

                case 'finished':
                    controls.phaseDisplay.textContent = 'Phase: Game Over';
                    controls.currentTurn.textContent = 'Game Finished!';
                    if (isHost) {
                        const btn = document.createElement('button');
                        btn.id = 'restart-btn';
                        btn.textContent = 'Restart Game';
                        btn.style.backgroundColor = '#27ae60';
                        btn.style.color = 'white';
                        btn.onclick = () => socket.emit('gameAction', { gameCode, action: 'restartGame' });
                        document.querySelector('.phase-actions').appendChild(btn);
                    }
                    break;
            }
        }
        function startLocalMemorizePhase() {
            setTimeout(() => {
                let timeLeft = 30;
                const countdownEl = document.getElementById('countdown');
                countdownEl.textContent = timeLeft;
                
                const myCards = document.querySelectorAll(`#${myPlayerId} .card`);
                myCards.forEach(c => c.classList.add('flipped'));
                
                if (memorizeTimer) {
                    clearInterval(memorizeTimer);
                }

                memorizeTimer = setInterval(() => {
                    timeLeft--;
                    countdownEl.textContent = timeLeft;
                    if (timeLeft <= 0) {
                        clearInterval(memorizeTimer);
                        myCards.forEach(c => c.classList.remove('flipped'));
                    }
                }, 1000);
            }, 100);
        }
        function showPlayerActions(show) {
            const actions = document.getElementById(`actions-${myPlayerId}`);
            if (actions) {
                actions.style.display = show ? 'flex' : 'none';
                if (show) {
                    actions.innerHTML = `
                        <button class="action-btn target-btn" onclick="makeSomeoneDrink()">
                            Make Someone Drink
                        </button>
                    `;
                }
            }
        }
        function openRules(event) {
            event.stopPropagation();
            const modal = document.getElementById("rules-modal");
            const textContainer = document.getElementById("rules-text");
            
            textContainer.textContent = "Loading Rules...";
            modal.style.display = "flex"; 

            fetch("rules.txt")
                .then(response => { 
                    if (!response.ok) {
                        throw new Error("rules.txt file not found!");
                    }
                    return response.text();
                })
                .then(data => {
                    textContainer.textContent = data;
                })
                .catch(error => {
                    console.error("Error fetching rules:", error);
                    textContainer.textContent = "Could not load rules. Make sure 'rules.txt' is in the public folder.";
                });
        }
        function closeRules(event) {
            event.stopPropagation();
            document.getElementById("rules-modal").style.display = "none";
        }    

        function sendChatMessage(event) {
            event.preventDefault();
            const input = document.getElementById('chat-input');
            const message = input.value;
            
            if (message.trim()) {
                socket.emit('chatMessage', {
                    gameCode: gameCode,
                    message: message
                });
                input.value = '';
            }
        }
        
        window.addEventListener('load', initSocket);

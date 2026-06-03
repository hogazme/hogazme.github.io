

const socket = io();
let playerId;
let players = new Map();

// Initial variables (will be set when receiving game state)
let carPositionX;
let carPositionY;
let energy = 100;
let money = 100;
let adminBudget = 100;
const mapSize = 1000;

let hasItem = false;
let currentItem = null;
let deliveryPoints = [];
let originalStartingPoint = null;
const DELIVERY_REWARD = 50;
const map = document.getElementById('map');

const getInitialParameters = async () => {
    try {
        const response = await fetch('/admin-parameters');
        const initialParameters = await response.json();
        adminBudget = parseInt(initialParameters.playerBudget);
    } catch (error) {
        console.log('there was an issue getting values from server. Using default values...', error);
    }
}

getInitialParameters();

// Initialize delivery system
const initializeDeliverySystem = () => {
    deliveryPoints = ROAD_CONFIG.entryPoints.map(ep => ({
        id: ep.id,
        x: ep.x,
        y: ep.y,
        name: ep.name,
        color: ep.color,
        pointNumber: ep.pointNumber
    }));

    // Don't spawn items automatically since players start with items
    updateItemIndicator();
};

// Function to spawn a random item at a random delivery point
const spawnRandomItem = () => {
    // Remove any existing items
    document.querySelectorAll('.delivery-item').forEach(item => item.remove());

    // Don't spawn if player already has an item
    if (hasItem) return;

    // Choose random delivery point for pickup
    const pickupPoint = deliveryPoints[Math.floor(Math.random() * deliveryPoints.length)];

    // Choose random different delivery point for destination
    let destinationPoint;
    do {
        destinationPoint = deliveryPoints[Math.floor(Math.random() * deliveryPoints.length)];
    } while (destinationPoint.id === pickupPoint.id);

    // Create item element
    const itemElement = document.createElement('div');
    itemElement.className = 'delivery-item';
    itemElement.textContent = '📦';
    itemElement.style.left = `${pickupPoint.x}px`;
    itemElement.style.top = `${pickupPoint.y}px`;
    itemElement.dataset.pickupId = pickupPoint.id;
    itemElement.dataset.destinationId = destinationPoint.id;
    itemElement.dataset.destinationName = destinationPoint.name;

    map.appendChild(itemElement);

    // Highlight destination point
    highlightDestination(destinationPoint.id);
};

// Function to highlight destination point
const highlightDestination = (pointId) => {
    // Remove previous highlights
    document.querySelectorAll('.delivery-destination').forEach(el => {
        el.classList.remove('delivery-destination');
    });

    // Find and highlight the destination point
    const destinationElements = {
        'left': document.querySelector('.entry-road-left'),
        'right': document.querySelector('.exit-road-right'),
        'top': document.querySelector('.entry-road-top'),
        'bottom': document.querySelector('.exit-road-bottom')
    };

    if (destinationElements[pointId]) {
        destinationElements[pointId].classList.add('delivery-destination');
    }
};

// Function to update item indicator
const updateItemIndicator = () => {
    const el = document.getElementById('item-indicator');
    if (!el) return;
    if (hasItem && currentItem) {
        el.textContent = `Deliver to ${currentItem.destinationName}`;
        el.style.color = '#fb923c';
    } else {
        el.textContent = 'No delivery item';
        el.style.color = '#94a3b8';
    }
};

// Function to check for item pickup/delivery
const checkDeliveryInteraction = () => {
    const tolerance = 25;

    if (!hasItem) {
        // Check for item pickup
        const items = document.querySelectorAll('.delivery-item');
        items.forEach(item => {
            const itemX = parseInt(item.style.left);
            const itemY = parseInt(item.style.top);

            if (Math.abs(carPositionX - itemX) < tolerance && Math.abs(carPositionY - itemY) < tolerance) {
                // Pick up item
                hasItem = true;
                currentItem = {
                    destinationId: item.dataset.destinationId,
                    destinationName: item.dataset.destinationName
                };

                // Remove item from map
                item.remove();

                // Update UI
                updateItemIndicator();
                showNotification(`Picked up delivery item! Deliver to ${currentItem.destinationName}`, 'info');

                // Get pickup point number
                const pickupPoint = deliveryPoints.find(point => point.x === itemX && point.y === itemY);

                // Emit pickup event
                socket.emit('itemPickup', {
                    playerId: playerId,
                    pickupPoint: pickupPoint ? pickupPoint.pointNumber : 'unknown',
                    itemDestination: currentItem.destinationId,
                    destinationPoint: deliveryPoints.find(point => point.id === currentItem.destinationId)?.pointNumber || 'unknown',
                    timestamp: Date.now()
                });
            }
        });
    } else {
        // Check for delivery
        const destination = deliveryPoints.find(point => point.id === currentItem.destinationId);
        if (destination) {
            if (Math.abs(carPositionX - destination.x) < tolerance && Math.abs(carPositionY - destination.y) < tolerance) {
                // Deliver item
                money += DELIVERY_REWARD;
                hasItem = false;

                // Remove destination highlight
                document.querySelectorAll('.delivery-destination').forEach(el => {
                    el.classList.remove('delivery-destination');
                });

                // Update UI
                updateMoneyIndicator();
                updateItemIndicator();
                showNotification(`Item delivered! +$${DELIVERY_REWARD}`, 'success');

                // Emit delivery event
                socket.emit('itemDelivery', {
                    playerId: playerId,
                    destinationId: currentItem.destinationId,
                    deliveryPoint: destination.pointNumber,
                    reward: DELIVERY_REWARD,
                    timestamp: Date.now()
                });

                currentItem = null;
                originalStartingPoint = null; // Clear old starting point

                // Assign new item to player after a short delay
                setTimeout(() => {
                    startWithInitialItem();
                }, 2000);
            }
        }
    }
};

initializeDeliverySystem();

const generateCityBlocks = () => {
    const map = document.getElementById('map');
    const vRoads = ROAD_CONFIG.verticalRoads.map(r => r.left).sort((a, b) => a - b);
    const hRoads = ROAD_CONFIG.horizontalRoads.map(r => r.top).sort((a, b) => a - b);
    const roadW = ROAD_CONFIG.roadWidth;

    const blockColors = [
        { bg: '#d9d5cc', border: '#ccc8bf' },
        { bg: '#ddd9d0', border: '#d0ccc3' },
        { bg: '#d5d1c8', border: '#c8c4bb' },
        { bg: '#dbd8cf', border: '#cecbc2' },
        { bg: '#d7d3ca', border: '#cac6bd' },
    ];
    const parkColor = { bg: '#c8d6bc', border: '#b8c6ac' };

    for (let i = 0; i < vRoads.length - 1; i++) {
        for (let j = 0; j < hRoads.length - 1; j++) {
            const x = vRoads[i] + roadW;
            const y = hRoads[j] + roadW;
            const w = vRoads[i + 1] - x;
            const h = hRoads[j + 1] - y;

            if (w <= 0 || h <= 0) continue;

            const block = document.createElement('div');
            block.className = 'city-block';

            const isPark = Math.random() < 0.15;
            const palette = isPark ? parkColor : blockColors[Math.floor(Math.random() * blockColors.length)];

            block.style.cssText = `
                position: absolute;
                left: ${x}px;
                top: ${y}px;
                width: ${w}px;
                height: ${h}px;
                background-color: ${palette.bg};
                border: 1px solid ${palette.border};
                border-radius: 2px;
                z-index: 1;
            `;


            map.appendChild(block);
        }
    }
};

// Function to start player with an initial item
const startWithInitialItem = () => {
    if (hasItem) return; // Don't override if already has item

    // Store current position as the original starting point for this delivery
    originalStartingPoint = {
        x: carPositionX,
        y: carPositionY
    };

    // Choose random destination different from current position
    let possibleDestinations = deliveryPoints.filter(point => {
        const distance = Math.abs(carPositionX - point.x) + Math.abs(carPositionY - point.y);
        return distance > 100; // Make sure it's not the same point they're starting at
    });

    if (possibleDestinations.length === 0) {
        possibleDestinations = deliveryPoints; // Fallback to any destination
    }

    const destinationPoint = possibleDestinations[Math.floor(Math.random() * possibleDestinations.length)];

    // Set up initial item
    hasItem = true;
    currentItem = {
        destinationId: destinationPoint.id,
        destinationName: destinationPoint.name
    };

    // Highlight destination
    highlightDestination(destinationPoint.id);

    // Update UI
    updateItemIndicator();
    showNotification(`Starting with delivery item! Deliver to ${currentItem.destinationName}`, 'info');

    // Log initial item assignment
    socket.emit('itemAssigned', {
        playerId: playerId,
        destinationPoint: destinationPoint.pointNumber,
        destinationPointName: destinationPoint.name,
        timestamp: Date.now()
    });
};

        // Handle initial game state
        socket.on('gameState', (data) => {
            generateCityBlocks();
            playerId = data.playerId;
            const currentPlayer = data.players.find(p => p.id === playerId);

            // Set initial position from server
            carPositionX = currentPlayer.positionX;
            carPositionY = currentPlayer.positionY;

            // Set money from server and update UI
            money = currentPlayer.money;
            updateMoneyIndicator();

            // Display player name in UI
            const playerNameDisplay = document.getElementById('player-name-display');
            if (playerNameDisplay && currentPlayer.name) {
                playerNameDisplay.textContent = currentPlayer.name;
                playerNameDisplay.style.color = currentPlayer.color || '#2c3e50';
            }

            // Create all players including self
            data.players.forEach(player => {
                createPlayerCar(player);
                players.set(player.id, player);
            });

            // Create charging stations from server data
            createChargingStationsFromServer(data.stations);

            // Start with an item after everything is loaded
            setTimeout(() => {
                startWithInitialItem();
            }, 500);
        });

        // Handle station updates from admin
        socket.on('stationsUpdated', (data) => {
            // Clear existing stations
            document.querySelectorAll('.station').forEach(el => el.remove());
            document.querySelectorAll('.parking-lot').forEach(el => el.remove());
            document.querySelectorAll('.station-tooltip').forEach(el => el.remove());

            // Create new stations
            createChargingStationsFromServer(data.stations);
        });

        function createPlayerCar(player) {
            const playerCar = document.createElement('div');
            playerCar.id = `car-${player.id}`;
            playerCar.className = 'car';
            playerCar.style.position = 'absolute';
            playerCar.style.left = player.positionX + "px";
            playerCar.style.top = player.positionY + "px";
            playerCar.style.color = player.color;

            // Add car icon
            const carIcon = document.createElement('i');
            carIcon.className = 'fas fa-car';
            playerCar.appendChild(carIcon);

            // Create player name label
            const nameLabel = document.createElement('div');
            nameLabel.className = 'player-name';
            nameLabel.textContent = player.name;
            nameLabel.style.position = 'absolute';
            nameLabel.style.top = '-20px';
            nameLabel.style.left = '50%';
            nameLabel.style.transform = 'translateX(-50%)';
            nameLabel.style.color = 'black';
            nameLabel.style.fontSize = '12px';
            nameLabel.style.fontWeight = 'bold';
            nameLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
            nameLabel.style.padding = '2px 5px';
            nameLabel.style.borderRadius = '3px';
            nameLabel.style.whiteSpace = 'nowrap';

            playerCar.appendChild(nameLabel);
            map.appendChild(playerCar);
        }

        // Handle new player joining
        socket.on('playerJoined', (player) => {
            createPlayerCar(player);
            players.set(player.id, player);
        });

        // Handle player movement
        socket.on('playerMoved', (data) => {
            const playerCar = document.getElementById(`car-${data.id}`);
            if (playerCar) {
                // Update position regardless of charging state
                playerCar.style.left = data.positionX + "px";
                playerCar.style.top = data.positionY + "px";

                if (players.has(data.id)) {
                    const player = players.get(data.id);
                    player.energy = data.energy;
                    player.isCharging = data.isCharging;

                    // Update charging station display if player is charging
                    if (data.isCharging && player.chargingStationId) {
                        const station = document.querySelector(`.station[data-id="${player.chargingStationId}"]`);
                        if (station) {
                            station.classList.add('charging');
                        }
                    } else if (!data.isCharging && player.chargingStationId) {
                        const station = document.querySelector(`.station[data-id="${player.chargingStationId}"]`);
                        if (station) {
                            station.classList.remove('charging');
                        }
                    }
                }
            }
        });

        socket.on('playerReset', (data) => {
            const playerCar = document.getElementById(`car-${playerId}`);
            if (playerCar) {
                playerCar.style.left = data.positionX + "px";
                playerCar.style.top = data.positionY + "px";
            }
        });

// Add charging variables
let isCharging = false;
let chargingInterval = null;
let chargingStation = null;
// Remove the global const CHARGING_DURATION = 60000; // 60 seconds in milliseconds

// Track active chargers at each station
const activeChargers = new Map();
const chargingPlayers = new Map(); // Track which players are charging at each station

// Function that causes energy bar to gradually increase
const updateEnergyGradually = (startEnergy, targetEnergy, duration) => {
    const startTime = Date.now();
    const energyDiff = targetEnergy - startEnergy;

    chargingInterval = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        energy = Math.round(startEnergy + (energyDiff * progress));
        updateEnergyBar();

        if (progress >= 1) {
            clearInterval(chargingInterval);
            isCharging = false;
            chargingInterval = null;

            // Show notification when fully charged
            showNotification('Car is fully charged!');

            if (chargingStation) {
                const currentChargers = activeChargers.get(chargingStation) || 0;
                activeChargers.set(chargingStation, Math.max(0, currentChargers - 1));

                const stationPlayers = chargingPlayers.get(chargingStation) || new Set();
                stationPlayers.delete(playerId);
                chargingPlayers.set(chargingStation, stationPlayers);

                socket.emit('chargingComplete', {
                    stationId: chargingStation.dataset.id,
                    currentChargers: Math.max(0, currentChargers - 1),
                    playerId: playerId,
                    positionX: carPositionX,
                    positionY: carPositionY
                });

                chargingStation.classList.remove('charging');
                chargingStation = null;

                // Remove cancel button and charging time display
                const cancelButton = document.querySelector('.cancel-charge-button');
                if (cancelButton) {
                    cancelButton.remove();
                }
                const chargingTimeDisplay = document.querySelector('.charging-time');
                if (chargingTimeDisplay) {
                    chargingTimeDisplay.remove();
                }
            }
        }
    }, 100); // Update every 100ms for smooth animation
};

// Update validateSocketAvailability function
const validateSocketAvailability = (station) => {
    const maxSockets = parseInt(station.dataset.sockets, 10);
    const currentChargers = activeChargers.get(station) || 0;
    const cost = parseInt(station.dataset.cost, 10);

    // Check if player has enough money
    if (money < cost) {
        showNotification('Not enough money to charge!', 'error');
        return;
    }

    // Check with server before allowing charge
    socket.emit('validateCharging', {
        stationId: station.dataset.id,  // Use dataset.id instead of id
        currentChargers: currentChargers,
        playerId: playerId,
        cost: cost
    });
};

// Update socket event handlers for charging
socket.on('chargingValidation', (data) => {
    const station = document.querySelector(`.station[data-id="${data.stationId}"]`);
    if (station && data.canCharge) {
        // Update local state
        activeChargers.set(station, data.currentChargers);
        const stationPlayers = chargingPlayers.get(station) || new Set();
        stationPlayers.add(playerId);
        chargingPlayers.set(station, stationPlayers);

        // Start charging process
        startCharging(station);
    } else if (station) {
        // Show error message
        const errorDisplay = document.createElement('div');
        errorDisplay.className = 'charging-time';
        errorDisplay.textContent = data.message || 'Cannot charge at this station';
        errorDisplay.style.position = 'absolute';
        errorDisplay.style.top = `${parseInt(station.style.top) - 70}px`; // Move up to avoid charge button
        errorDisplay.style.left = `${parseInt(station.style.left)}px`;
        errorDisplay.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
        errorDisplay.style.padding = '2px 5px';
        errorDisplay.style.borderRadius = '3px';
        errorDisplay.style.fontSize = '12px';
        errorDisplay.style.zIndex = '999'; // Ensure it's above other elements
        map.appendChild(errorDisplay);

        setTimeout(() => {
            if (errorDisplay.parentNode) {
                errorDisplay.parentNode.removeChild(errorDisplay);
            }
        }, 3000);
    }
});

// Update createCancelButton function
const createCancelButton = (station) => {
    const cancelButton = document.createElement('button');
    cancelButton.className = 'cancel-charge-button';
    cancelButton.textContent = 'Cancel Charging';
    cancelButton.style.top = `${parseInt(station.style.top) - 40}px`;
    cancelButton.style.left = `${parseInt(station.style.left)}px`;

    cancelButton.addEventListener('click', () => {
        // Emit buttonClick event for cancel charging
        socket.emit('buttonClick', {
            playerId: playerId,
            button: 'cancelCharging',
            stationId: station.dataset.id,
            timestamp: Date.now()
        });
        // Stop charging process
        isCharging = false;
        if (chargingInterval) {
            clearInterval(chargingInterval);
            chargingInterval = null;
        }

        socket.emit('chargingStop', {
            stationId: station.dataset.id,
            currentChargers: activeChargers.get(station) || 0,
            playerId: playerId,
            positionX: carPositionX,
            positionY: carPositionY
        });

        // Update charging station state
        const currentChargers = activeChargers.get(station) || 0;
        const stationPlayers = chargingPlayers.get(station) || new Set();
        stationPlayers.delete(playerId);
        chargingPlayers.set(station, stationPlayers);
        activeChargers.set(station, Math.max(0, currentChargers - 1));

        // Remove charging animation
        station.classList.remove('charging');
        chargingStation = null;

        // Remove cancel button and any charging time displays
        const cancelButton = document.querySelector('.cancel-charge-button');
        if (cancelButton) {
            cancelButton.remove();
        }
        const chargingTimeDisplay = document.querySelector('.charging-time');
        if (chargingTimeDisplay) {
            chargingTimeDisplay.remove();
        }
    });

    return cancelButton;
};

// Update socket event handlers for charging
socket.on('chargingStart', (data) => {
    const station = document.querySelector(`.station[data-id="${data.stationId}"]`);
    if (station) {
        activeChargers.set(station, data.currentChargers);
        const stationPlayers = chargingPlayers.get(station) || new Set();
        stationPlayers.add(data.playerId);
        chargingPlayers.set(station, stationPlayers);


        // Update charging display for all players
        updateChargingDisplay(station, data.currentChargers);

        // Add charging animation
        station.classList.add('charging');

        // Add cancel button if it's the current player
        if (data.playerId === playerId) {
            const cancelButton = createCancelButton(station);
            map.appendChild(cancelButton);
        }
    }
});

socket.on('chargingStop', (data) => {
    const station = document.querySelector(`.station[data-id="${data.stationId}"]`);
    if (station) {
        activeChargers.set(station, data.currentChargers);
        const stationPlayers = chargingPlayers.get(station) || new Set();

        // Handle forced reset (simulation start) differently
        if (data.forced) {
            // Clear all players from this station
            stationPlayers.clear();
        } else {
            // Normal charging stop - remove specific player
            stationPlayers.delete(data.playerId);
        }
        chargingPlayers.set(station, stationPlayers);


        // Update charging display for all players
        updateChargingDisplay(station, data.currentChargers);

        // Remove charging animation
        station.classList.remove('charging');

        // Remove cancel button and charging time display for forced reset or current player
        if (data.forced || data.playerId === playerId) {
            document.querySelectorAll('.cancel-charge-button').forEach(button => button.remove());
            document.querySelectorAll('.charging-time').forEach(display => display.remove());
        }
    }
});

socket.on('chargingComplete', (data) => {
    const station = document.querySelector(`.station[data-id="${data.stationId}"]`);
    if (station) {
        activeChargers.set(station, data.currentChargers);
        const stationPlayers = chargingPlayers.get(station) || new Set();
        stationPlayers.delete(data.playerId);
        chargingPlayers.set(station, stationPlayers);


        // Update charging display for all players
        updateChargingDisplay(station, data.currentChargers);

        // Remove charging animation if no players are charging
        if (data.currentChargers === 0) {
            station.classList.remove('charging');
        }

        // Remove cancel button and charging time display
        const cancelButton = document.querySelector('.cancel-charge-button');
        if (cancelButton) {
            cancelButton.remove();
        }
        const chargingTimeDisplay = document.querySelector('.charging-time');
        if (chargingTimeDisplay) {
            chargingTimeDisplay.remove();
        }
    }
});

// Add movement state tracking
let isMoving = false;
let lastMoveTime = 0;
const MOVE_STOP_THRESHOLD = 500; // 500ms threshold to consider movement stopped

// Update moveCar function to track movement state
const moveCar = (direction) => {
    if (energy > 0 && !isCharging) {  // Add check for isCharging
        let moved = false;
        let newX = carPositionX;
        let newY = carPositionY;
        let rotation = 0;

        // Define valid road areas including edges
        const roads = ROAD_CONFIG.toRectangles();

        // Propose new position based on direction
        switch (direction) {
            case 'right':
                newX += 5;
                rotation = 0;
                break;
            case 'left':
                newX -= 5;
                rotation = 0;
                break;
            case 'up':
                newY -= 5;
                rotation = 270;
                break;
            case 'down':
                newY += 5;
                rotation = 90;
                break;
        }

        // Check if new position is within any road
        const isOnRoad = roads.some(road =>
            newX >= road.left &&
            newX < road.left + road.width &&
            newY >= road.top &&
            newY < road.top + road.height
        );

        if (isOnRoad) {
            carPositionX = newX;
            carPositionY = newY;
            moved = true;
        }

        if (moved) {
            reduceEnergy();
            const playerCar = document.getElementById(`car-${playerId}`);
            if (playerCar) {
                playerCar.style.left = carPositionX + "px";
                playerCar.style.top = carPositionY + "px";
                playerCar.style.transform = `rotate(${rotation}deg)`;
            }

            checkCollision();
            checkDeliveryInteraction();

            // Track movement state
            const currentTime = Date.now();
            const wasMoving = isMoving;
            isMoving = true;
            lastMoveTime = currentTime;

            // Only emit movePlayer event if this is the start of movement
            if (!wasMoving) {
                socket.emit('movePlayer', {
                    positionX: carPositionX,
                    positionY: carPositionY,
                    energy: energy,
                    isCharging: false,
                    timestamp: currentTime,
                    arrowKey: direction,
                    action: 'start' // Indicate this is start of movement
                });
            } else {
                // For continuous movement, just send position update without logging
                socket.emit('movePlayer', {
                    positionX: carPositionX,
                    positionY: carPositionY,
                    energy: energy,
                    isCharging: false,
                    timestamp: currentTime,
                    arrowKey: direction,
                    action: 'continue' // Indicate this is continuous movement
                });
            }
        }
    } else if (isCharging) {
        console.log("Cannot move while charging!");
    } else {
        console.log("Your energy has run out! You cannot move.");
    }
};

// Add function to check if movement has stopped
const checkMovementStop = () => {
    if (isMoving && (Date.now() - lastMoveTime) > MOVE_STOP_THRESHOLD) {
        isMoving = false;
        // Emit stop movement event
        socket.emit('movePlayer', {
            positionX: carPositionX,
            positionY: carPositionY,
            energy: energy,
            isCharging: false,
            timestamp: Date.now(),
            action: 'stop' // Indicate this is stop of movement
        });
    }
};

// Check for movement stop periodically
setInterval(checkMovementStop, 100);

// Update keyboard controls to pass the correct arrow key
window.addEventListener('keydown', (event) => {
    switch(event.key) {
        case 'ArrowRight':
            moveCar('right');
            break;
        case 'ArrowLeft':
            moveCar('left');
            break;
        case 'ArrowUp':
            moveCar('up');
            break;
        case 'ArrowDown':
            moveCar('down');
            break;
    }
});

// Function to update the energy bar
const updateEnergyBar = () => {
    const bar = document.getElementById('energy-bar');
    const value = document.getElementById('energy-value');
    if (bar) bar.style.width = energy + '%';
    if (value) value.textContent = Math.round(energy) + '%';
};

// Function to update the money indicator
const updateMoneyIndicator = () => {
    const el = document.getElementById('money-indicator');
    if (el) el.textContent = `$${money}`;
};

// Reduce energy with movement, more slowly
const reduceEnergy = () => {
    if (energy > 0) {
        energy -= 0.625;  // Reduce energy to allow 800 pixels travel (100 energy / 160 moves = 0.625 per move)
        updateEnergyBar();  // Update energy bar

        // Show notification when energy runs out
        if (energy <= 0) {
            energy = 0; // Ensure energy doesn't go below 0
            showNotification('Car is out of energy!', 'error');
        }
    }
};

// Function to create charging stations from server data
const createChargingStationsFromServer = (stations) => {
    // Keep track of used parking lot rectangles to avoid overlaps
    const usedParkingRects = [];

    // Sort stations by their position to ensure consistent parking lot assignment
    stations.sort((a, b) => {
        if (a.top === b.top) {
            return a.left - b.left;
        }
        return a.top - b.top;
    });

    stations.forEach(station => {
        // Use the chargeTime provided by the server
        const chargeTime = station.chargeTime;
        // Create the station element
        const stationElement = document.createElement('div');
        stationElement.className = 'station';
        stationElement.style.top = `${station.top}px`;
        stationElement.style.left = `${station.left}px`;
        stationElement.dataset.cost = station.cost;
        stationElement.dataset.sockets = station.sockets;
        stationElement.dataset.id = station.id;
        stationElement.dataset.chargeTime = chargeTime; // Store charge time in dataset

        // Add charging station icon
        const stationIcon = document.createElement('i');
        stationIcon.className = 'fas fa-charging-station';
        stationElement.appendChild(stationIcon);


        // Find a parking position close to the station
        const parkingPosition = findClosestParkingPosition(station, usedParkingRects);

        if (parkingPosition) {
            // Store the rectangle for overlap checking (x, y, width, height)
            usedParkingRects.push({
                x: parkingPosition.x,
                y: parkingPosition.y,
                width: 25,
                height: 25
            });

            // Create parking lot
            const parkingLot = document.createElement('div');
            parkingLot.className = 'parking-lot';
            parkingLot.style.top = `${parkingPosition.y}px`;
            parkingLot.style.left = `${parkingPosition.x}px`;

            // Create parking count indicator
            const parkingCount = document.createElement('div');
            parkingCount.className = 'parking-count';
            parkingCount.textContent = '0/' + station.sockets;
            parkingLot.appendChild(parkingCount);

            // Create only one parking spot (regardless of station sockets)
            const spot = document.createElement('div');
            spot.className = 'parking-spot';
            spot.dataset.index = 0;
            const carIcon = document.createElement('i');
            carIcon.className = 'fas fa-car';
            spot.appendChild(carIcon);

            // Add click event listener for charging
            spot.addEventListener('click', () => {
                const cost = parseInt(stationElement.dataset.cost, 10);
                const maxSockets = parseInt(stationElement.dataset.sockets, 10);
                const currentChargers = activeChargers.get(stationElement) || 0;
                const stationPlayers = chargingPlayers.get(stationElement) || new Set();
                const isAlreadyCharging = stationPlayers.has(playerId);

                // Only allow charging if not already charging and has enough money
                if (!isPlayerNearStation(stationElement)) {
                    showNotification('You must be at the station to charge!', 'error');
                } else if (!isCharging && !isAlreadyCharging && money >= cost) {
                    socket.emit('buttonClick', {
                        playerId: playerId,
                        button: 'charge',
                        stationId: stationElement.dataset.id,
                        timestamp: Date.now()
                    });
                    validateSocketAvailability(stationElement);
                } else if (money < cost) {
                    showNotification('Not enough money to charge!', 'error');
                } else if (isAlreadyCharging) {
                    showNotification('You are already charging at this station!', 'error');
                }
            });

            parkingLot.appendChild(spot);

            createStationTooltip(stationElement, station);

            map.appendChild(stationElement);
            map.appendChild(parkingLot);
        }
    });
};

const isPlayerNearStation = (stationElement) => {
    const stationX = parseInt(stationElement.style.left);
    const stationY = parseInt(stationElement.style.top);
    const tolerance = 40;
    return Math.abs(carPositionX - stationX) < tolerance && Math.abs(carPositionY - stationY) < tolerance;
};

const createStationTooltip = (stationElement, station) => {
    stationElement.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.station-tooltip').forEach(t => t.remove());

        const currentChargers = activeChargers.get(stationElement) || 0;
        const availableSockets = station.sockets - currentChargers;
        const chargeTime = stationElement.dataset.chargeTime;

        const tooltip = document.createElement('div');
        tooltip.className = 'station-tooltip';

        let statusColor = '#4ade80';
        let statusText = 'Available';
        if (availableSockets === 0) { statusColor = '#ef4444'; statusText = 'Full'; }
        else if (currentChargers > 0) { statusColor = '#facc15'; statusText = 'Busy'; }

        tooltip.innerHTML = `
            <div class="tooltip-header"><i class="fas fa-charging-station"></i> Charging Station</div>
            <div class="tooltip-row"><span class="label">Price</span><span class="value" style="color:#4ade80">$${station.cost}</span></div>
            <div class="tooltip-row"><span class="label">Charge time</span><span class="value">${chargeTime}s</span></div>
            <div class="tooltip-row"><span class="label">Sockets</span><span class="value">${availableSockets}/${station.sockets} free</span></div>
            <div class="tooltip-row"><span class="label">Status</span><span class="value" style="color:${statusColor}">${statusText}</span></div>
        `;

        if (!isCharging) {
            const chargeBtn = document.createElement('button');
            chargeBtn.className = 'charge-btn';
            const nearStation = isPlayerNearStation(stationElement);
            chargeBtn.textContent = `Charge ($${station.cost})`;
            if (!nearStation) {
                chargeBtn.disabled = true;
                chargeBtn.textContent = 'Drive to station first';
            } else if (money < station.cost) {
                chargeBtn.disabled = true;
                chargeBtn.textContent = 'Not enough money';
            } else if (availableSockets === 0) {
                chargeBtn.disabled = true;
                chargeBtn.textContent = 'No sockets available';
            }
            chargeBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!isPlayerNearStation(stationElement)) {
                    showNotification('You must be at the station to charge!', 'error');
                    return;
                }
                socket.emit('buttonClick', {
                    playerId: playerId,
                    button: 'charge',
                    infoType: 'tooltip',
                    stationId: stationElement.dataset.id,
                    timestamp: Date.now()
                });
                validateSocketAvailability(stationElement);
                tooltip.remove();
            });
            tooltip.appendChild(chargeBtn);
        }

        let tooltipLeft = parseInt(stationElement.style.left) + 44;
        let tooltipTop = parseInt(stationElement.style.top) - 10;
        if (tooltipLeft + 180 > 1000) tooltipLeft = parseInt(stationElement.style.left) - 180;
        if (tooltipTop < 10) tooltipTop = 10;

        tooltip.style.left = tooltipLeft + 'px';
        tooltip.style.top = tooltipTop + 'px';

        socket.emit('buttonClick', {
            playerId: playerId,
            button: 'stationInfo',
            infoType: 'tooltip_view',
            stationId: stationElement.dataset.id,
            timestamp: Date.now()
        });

        map.appendChild(tooltip);
    });
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('.station') && !e.target.closest('.station-tooltip')) {
        document.querySelectorAll('.station-tooltip').forEach(t => t.remove());
    }
});

// Function to check if two rectangles overlap
function rectsOverlap(r1, r2) {
    return (
        r1.x < r2.x + r2.width &&
        r1.x + r1.width > r2.x &&
        r1.y < r2.y + r2.height &&
        r1.y + r1.height > r2.y
    );
}

// Function to find the closest available parking position to a station
const findClosestParkingPosition = (station, usedParkingRects) => {
    const stationX = station.left;
    const stationY = station.top;
    const lotWidth = 25;
    const lotHeight = 25;

    // Define possible parking positions around the station (in order of preference)
    const possiblePositions = [
        // Very close positions (preferred)
        { x: stationX + 40, y: stationY },      // Right of station
        { x: stationX - 40, y: stationY },      // Left of station
        { x: stationX, y: stationY + 40 },      // Below station
        { x: stationX, y: stationY - 40 },      // Above station
        // Diagonal positions (if close ones are taken)
        { x: stationX + 40, y: stationY + 40 }, // Bottom-right
        { x: stationX - 40, y: stationY + 40 }, // Bottom-left
        { x: stationX + 40, y: stationY - 40 }, // Top-right
        { x: stationX - 40, y: stationY - 40 }, // Top-left
        // Slightly further positions (fallback)
        { x: stationX + 60, y: stationY },      // Further right
        { x: stationX - 60, y: stationY },      // Further left
        { x: stationX, y: stationY + 60 },      // Further below
        { x: stationX, y: stationY - 60 },      // Further above
    ];

    // Check each position in order of preference
    for (const pos of possiblePositions) {
        // Check if position is within map bounds
        if (pos.x < 0 || pos.x > 965 || pos.y < 0 || pos.y > 965) continue;
        // Check if position is not on a road
        if (isPositionOnRoad(pos.x, pos.y)) continue;
        // Check for overlap with any existing parking lot
        const newRect = { x: pos.x, y: pos.y, width: lotWidth, height: lotHeight };
        let overlaps = false;
        for (const rect of usedParkingRects) {
            if (rectsOverlap(newRect, rect)) {
                overlaps = true;
                break;
            }
        }
        if (!overlaps) {
            return pos;
        }
    }
    // If no suitable position found, return null
    return null;
};

// Function to check if a position is on a road
const isPositionOnRoad = (x, y) => {
    const lotWidth = 25;
    const lotHeight = 25;
    const roads = ROAD_CONFIG.toRectangles();

    // Check if any part of the parking lot rectangle overlaps with any road
    return roads.some(road =>
        x < road.left + road.width &&
        x + lotWidth > road.left &&
        y < road.top + road.height &&
        y + lotHeight > road.top
    );
};






    // Function to get random spawn position at entry points
    const getRandomSpawnPosition = () => {
        const spawnPoints = ROAD_CONFIG.entryPoints.map(ep => ({
            x: ep.x, y: ep.y, pointNumber: ep.pointNumber
        }));

        return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    };

    // Add reset button event listener
    document.getElementById('reset-button').addEventListener('click', () => {
        // Emit buttonClick event with timestamp
        socket.emit('buttonClick', {
            playerId: playerId,
            button: 'reset',
            timestamp: Date.now()
        });

        // Reset to original starting point if available, otherwise use random spawn
        if (originalStartingPoint && hasItem) {
            // Reset to where player started with current delivery item
            carPositionX = originalStartingPoint.x;
            carPositionY = originalStartingPoint.y;
        } else {
            // Fallback to random spawn if no original starting point
            const spawnPosition = getRandomSpawnPosition();
            carPositionX = spawnPosition.x;
            carPositionY = spawnPosition.y;
        }

        // Reset energy only (keep money and delivery state)
        energy = 100;

        // Update UI
        updateEnergyBar();
        updateMoneyIndicator();
        updateItemIndicator();

        // Keep current delivery item and destination (don't reset delivery state)
        // Re-highlight the current destination if player has an item
        if (hasItem && currentItem) {
            highlightDestination(currentItem.destinationId);
            showNotification(`Reset to starting point! Continue delivery to ${currentItem.destinationName}`, 'info');
        }

        // Update car position
        const playerCar = document.getElementById(`car-${playerId}`);
        if (playerCar) {
            playerCar.style.left = carPositionX + "px";
            playerCar.style.top = carPositionY + "px";
        }

        // Emit reset event to server
        socket.emit('resetPlayer', {
            positionX: carPositionX,
            positionY: carPositionY,
            energy: energy,
            money: money
        });
    });

    // Add function to find nearest non-road square
    const findNearestNonRoadSquare = (stationX, stationY) => {
        // Define possible positions around the station (excluding road positions)
        const possiblePositions = [
            { x: stationX - 40, y: stationY }, // left
            { x: stationX + 40, y: stationY }, // right
            { x: stationX, y: stationY - 40 }, // up
            { x: stationX, y: stationY + 40 }  // down
        ];

        // Filter out positions that are on roads
        const roads = ROAD_CONFIG.toRectangles();

        // Find the first position that's not on a road
        for (const pos of possiblePositions) {
            const isOnRoad = roads.some(road =>
                pos.x >= road.left &&
                pos.x < road.left + road.width &&
                pos.y >= road.top &&
                pos.y < road.top + road.height
            );

            if (!isOnRoad) {
                return pos;
            }
        }

        // If no non-road position found, return the original position
        return { x: stationX, y: stationY };
    };

    // Update checkCollision function
    const checkCollision = () => {
        const stations = document.querySelectorAll('.station');
        const car = document.getElementById(`car-${playerId}`);
        if (!car) return;

        const carRect = car.getBoundingClientRect();
        let isCollidingWithAny = false;

        // Remove all existing charge buttons first
        document.querySelectorAll('.charge-button').forEach(button => button.remove());

        stations.forEach(station => {
            const stationRect = station.getBoundingClientRect();

            // Calculate car center
            const carCenterX = carRect.left + carRect.width / 2;
            const carCenterY = carRect.top + carRect.height / 2;

            // Check collision with tolerance
            const tolerance = 5;
            const isColliding =
                carCenterX >= stationRect.left - tolerance &&
                carCenterX <= stationRect.right + tolerance &&
                carCenterY >= stationRect.top - tolerance &&
                carCenterY <= stationRect.bottom + tolerance;

            if (isColliding) {
                isCollidingWithAny = true;
                const cost = parseInt(station.dataset.cost, 10);
                const maxSockets = parseInt(station.dataset.sockets, 10);
                const currentChargers = activeChargers.get(station) || 0;
                const stationPlayers = chargingPlayers.get(station) || new Set();
                const isAlreadyCharging = stationPlayers.has(playerId);

                // Create charge button if not already charging
                if (!isCharging && !isAlreadyCharging) {
                    const chargeButton = document.createElement('button');
                    chargeButton.className = 'charge-button';
                    chargeButton.textContent = `Charge ($${cost})`;
                    chargeButton.style.top = `${parseInt(station.style.top) - 40}px`;
                    chargeButton.style.left = `${parseInt(station.style.left)}px`;

                    // Disable button if not enough money
                    if (money < cost) {
                        chargeButton.disabled = true;
                        chargeButton.title = 'Not enough money';
                    }

                    chargeButton.addEventListener('click', () => {
                        if (money >= cost) {
                            // Emit buttonClick event with timestamp
                            socket.emit('buttonClick', {
                                playerId: playerId,
                                button: 'charge',
                                stationId: station.dataset.id,
                                timestamp: Date.now()
                            });
                            validateSocketAvailability(station);
                        }
                    });

                    map.appendChild(chargeButton);
                }
            }
        });

        // If not colliding with any station and was charging, stop charging
        if (!isCollidingWithAny && isCharging) {
            isCharging = false;
            if (chargingInterval) {
                clearInterval(chargingInterval);
                chargingInterval = null;
            }
            // Remove player from active chargers when leaving
            if (chargingStation) {
                const currentChargers = activeChargers.get(chargingStation) || 0;
                const stationPlayers = chargingPlayers.get(chargingStation) || new Set();

                // Only decrement if player was actually charging
                if (stationPlayers.has(playerId)) {
                    activeChargers.set(chargingStation, Math.max(0, currentChargers - 1));
                    stationPlayers.delete(playerId);
                    chargingPlayers.set(chargingStation, stationPlayers);

                    // Emit charging stop to all players
                    socket.emit('chargingStop', {
                        stationId: chargingStation.dataset.id,  // Use dataset.id instead of id
                        currentChargers: Math.max(0, currentChargers - 1),
                        playerId: playerId
                    });
                }
                chargingStation.classList.remove('charging');
                chargingStation = null;
            }
        }
    };

    // Update findChargingPosition function to handle multiple cars
    const findChargingPosition = (station, currentChargers) => {
        const stationX = parseInt(station.style.left);
        const stationY = parseInt(station.style.top);

        // Define possible charging positions relative to the station
        const chargingPositions = [
            { x: stationX - 40, y: stationY - 40 }, // top-left
            { x: stationX + 40, y: stationY - 40 }, // top-right
            { x: stationX - 40, y: stationY + 40 }, // bottom-left
            { x: stationX + 40, y: stationY + 40 }  // bottom-right
        ];

        // Get the position based on the number of current chargers
        const position = chargingPositions[currentChargers % chargingPositions.length];

        // Ensure the position is within map bounds
        position.x = Math.max(0, Math.min(position.x, mapSize - 30));
        position.y = Math.max(0, Math.min(position.y, mapSize - 30));

        return position;
    };

    // Update startCharging function
    const startCharging = (station) => {
        isCharging = true;
        chargingStation = station;

        const currentChargers = activeChargers.get(station) || 0;

        socket.emit('chargingStart', {
            stationId: station.dataset.id,
            currentChargers: currentChargers,
            playerId: playerId,
            positionX: carPositionX,
            positionY: carPositionY,
            chargingIndex: currentChargers
        });

        const cost = parseInt(station.dataset.cost, 10);
        money -= cost;
        updateMoneyIndicator();

        const startEnergy = energy;
        // Use the station's charge time (in seconds) for the charging duration
        const chargeTimeSeconds = parseInt(station.dataset.chargeTime, 10);
        const chargingDurationMs = chargeTimeSeconds * 1000;
        updateEnergyGradually(startEnergy, 100, chargingDurationMs);

        // Show charging time
        const chargingTimeDisplay = document.createElement('div');
        chargingTimeDisplay.className = 'charging-time';
        const maxSockets = parseInt(station.dataset.sockets, 10);
        chargingTimeDisplay.textContent = `Charging time: ${chargeTimeSeconds} seconds (${currentChargers}/${maxSockets} sockets in use)`;
        chargingTimeDisplay.style.position = 'absolute';
        chargingTimeDisplay.style.top = `${parseInt(station.style.top) - 70}px`;
        chargingTimeDisplay.style.left = `${parseInt(station.style.left)}px`;
        chargingTimeDisplay.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        chargingTimeDisplay.style.padding = '2px 5px';
        chargingTimeDisplay.style.borderRadius = '3px';
        chargingTimeDisplay.style.fontSize = '12px';
        chargingTimeDisplay.style.zIndex = '999';
        map.appendChild(chargingTimeDisplay);

        // Add cancel button
        const cancelButton = createCancelButton(station);
        map.appendChild(cancelButton);

        setTimeout(() => {
            if (chargingTimeDisplay.parentNode) {
                chargingTimeDisplay.parentNode.removeChild(chargingTimeDisplay);
            }
        }, 3000);

        station.classList.add('charging');
    };

    // Update updateChargingDisplay function
    const updateChargingDisplay = (station, currentChargers) => {
        const maxSockets = parseInt(station.dataset.sockets, 10);
        const availableSockets = maxSockets - currentChargers;

        // Update parking lot display
        const parkingLot = station.nextElementSibling;
        if (parkingLot && parkingLot.classList.contains('parking-lot')) {
            // Update parking count
            const parkingCount = parkingLot.querySelector('.parking-count');
            if (parkingCount) {
                parkingCount.textContent = `${currentChargers}/${maxSockets}`;
            }

            // Update the single parking spot
            const spot = parkingLot.querySelector('.parking-spot');
            if (spot) {
                if (currentChargers > 0) {
                    // Show car icon if any cars are charging
                    spot.classList.add('occupied');
                    const carIcon = spot.querySelector('.fa-car');
                    if (carIcon) {
                        carIcon.style.opacity = '1';
                    }
                } else {
                    // Hide car icon if no cars are charging
                    spot.classList.remove('occupied');
                    const carIcon = spot.querySelector('.fa-car');
                    if (carIcon) {
                        carIcon.style.opacity = '0';
                    }
                }
            }
        }

        // Update charging display
        const chargingDisplay = document.createElement('div');
        chargingDisplay.className = 'charging-time';
        chargingDisplay.textContent = `Charging: ${currentChargers}/${maxSockets} sockets in use`;
        chargingDisplay.style.position = 'absolute';
        chargingDisplay.style.top = `${parseInt(station.style.top) - 70}px`;
        chargingDisplay.style.left = `${parseInt(station.style.left)}px`;
        chargingDisplay.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        chargingDisplay.style.padding = '2px 5px';
        chargingDisplay.style.borderRadius = '3px';
        chargingDisplay.style.fontSize = '12px';
        chargingDisplay.style.zIndex = '999';

        // Remove any existing charging display
        const existingDisplay = station.parentNode.querySelector('.charging-time');
        if (existingDisplay) {
            existingDisplay.parentNode.removeChild(existingDisplay);
        }

        map.appendChild(chargingDisplay);

        // Remove display after 3 seconds
        setTimeout(() => {
            if (chargingDisplay.parentNode) {
                chargingDisplay.parentNode.removeChild(chargingDisplay);
            }
        }, 3000);
    };

    const showNotification = (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 3000);
    };

    // Function to reset client state for simulation start
    const resetClientForSimulation = () => {
        // Reset delivery system state
        hasItem = false;
        currentItem = null;
        originalStartingPoint = null;

        // Remove any existing delivery items and highlights
        document.querySelectorAll('.delivery-item').forEach(item => item.remove());
        document.querySelectorAll('.delivery-destination').forEach(el => {
            el.classList.remove('delivery-destination');
        });

        // Remove any charging buttons or displays
        document.querySelectorAll('.charge-button').forEach(button => button.remove());
        document.querySelectorAll('.cancel-charge-button').forEach(button => button.remove());
        document.querySelectorAll('.charging-time').forEach(display => display.remove());
        // Reset charging state and ensure car is visible
        isCharging = false;
        if (chargingInterval) {
            clearInterval(chargingInterval);
            chargingInterval = null;
        }
        chargingStation = null;

        // Make sure the player's car is visible and not stuck in charging state
        const playerCar = document.getElementById(`car-${playerId}`);
        if (playerCar) {
            playerCar.style.display = 'flex'; // Ensure car is visible
            delete playerCar.dataset.originalX; // Clear any stored positions
            delete playerCar.dataset.originalY;
        }

        // Remove charging animations from all stations
        document.querySelectorAll('.station').forEach(station => {
            station.classList.remove('charging');
        });

        // Clear charging maps
        activeChargers.clear();
        chargingPlayers.clear();

        // Update UI indicators
        updateItemIndicator();
        updateEnergyBar();
        updateMoneyIndicator();

        console.log('Client state reset for simulation start');
    };

    /* --- Minimap commented out — uncomment to re-enable ---
    const renderMinimap = () => {
        const canvas = document.getElementById('minimap');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const scale = 140 / 1060;

        ctx.clearRect(0, 0, 140, 140);

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 140, 140);

        const offset = 30;

        ctx.fillStyle = '#475569';
        for (const v of ROAD_CONFIG.verticalRoads) {
            ctx.fillRect((v.left + offset) * scale, offset * scale, ROAD_CONFIG.roadWidth * scale, ROAD_CONFIG.mapSize * scale);
        }
        for (const h of ROAD_CONFIG.horizontalRoads) {
            ctx.fillRect(offset * scale, (h.top + offset) * scale, ROAD_CONFIG.mapSize * scale, ROAD_CONFIG.roadWidth * scale);
        }

        for (const ep of ROAD_CONFIG.entryPoints) {
            ctx.fillStyle = ep.color;
            ctx.fillRect((ep.x + offset) * scale - 2, (ep.y + offset) * scale - 2, 5, 5);
        }

        if (hasItem && currentItem) {
            const dest = deliveryPoints.find(p => p.id === currentItem.destinationId);
            if (dest) {
                ctx.fillStyle = '#facc15';
                ctx.beginPath();
                ctx.arc((dest.x + offset) * scale, (dest.y + offset) * scale, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.fillStyle = '#f59e0b';
        document.querySelectorAll('.station').forEach(s => {
            const sx = parseInt(s.style.left);
            const sy = parseInt(s.style.top);
            ctx.fillRect((sx + offset) * scale - 1, (sy + offset) * scale - 1, 3, 3);
        });

        players.forEach((player, id) => {
            if (id === playerId) return;
            const car = document.getElementById(`car-${id}`);
            if (!car) return;
            const px = parseInt(car.style.left);
            const py = parseInt(car.style.top);
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath();
            ctx.arc((px + offset) * scale, (py + offset) * scale, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        if (carPositionX !== undefined) {
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc((carPositionX + offset) * scale, (carPositionY + offset) * scale, 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc((carPositionX + offset) * scale, (carPositionY + offset) * scale, 5 + Math.sin(Date.now() / 300) * 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    };

    setInterval(renderMinimap, 200);
    --- end minimap --- */

    const initDpad = () => {
        const dpad = document.getElementById('dpad');
        if (!dpad) return;

        let moveInterval = null;

        const startMove = (dir) => {
            if (moveInterval) return;
            moveCar(dir);
            moveInterval = setInterval(() => moveCar(dir), 80);
        };

        const stopMove = () => {
            if (moveInterval) {
                clearInterval(moveInterval);
                moveInterval = null;
            }
        };

        dpad.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
            const dir = btn.dataset.dir;

            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                startMove(dir);
            });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                stopMove();
            });
            btn.addEventListener('touchcancel', stopMove);

            btn.addEventListener('mousedown', () => startMove(dir));
            btn.addEventListener('mouseup', stopMove);
            btn.addEventListener('mouseleave', stopMove);
        });
    };

    initDpad();

    // Handle simulation events
    socket.on('simulationStarted', (data) => {
        showNotification(data.message, 'success');
        // Reset client state without reloading
        resetClientForSimulation();

        // Update all player positions from server
        if (data.players) {
            data.players.forEach(playerData => {
                const playerCar = document.getElementById(`car-${playerData.id}`);
                if (playerCar) {
                    playerCar.style.left = playerData.positionX + "px";
                    playerCar.style.top = playerData.positionY + "px";
                }

                // Update current player's state if this is our player
                if (playerData.id === playerId) {
                    carPositionX = playerData.positionX;
                    carPositionY = playerData.positionY;
                    energy = playerData.energy;
                    money = playerData.money;
                    updateEnergyBar();
                    updateMoneyIndicator();
                }
            });
        }

        // Start with a new delivery item after reset
        setTimeout(() => {
            startWithInitialItem();
        }, 1000);
    });

    socket.on('simulationInProgress', (data) => {
        // Show message that simulation is in progress and disconnect user
        document.body.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background-color: #f0f0f0;
                font-family: Arial, sans-serif;
                text-align: center;
                padding: 20px;
            ">
                <h1 style="color: #FF9800; font-size: 48px; margin-bottom: 20px;">
                    Simulation In Progress
                </h1>
                <p style="font-size: 24px; color: #666; margin-bottom: 30px;">
                    ${data.message}
                </p>
                <p style="font-size: 18px; color: #888;">
                    Please try again later when the simulation has finished.
                </p>
                <button onclick="location.reload()" style="
                    background-color: #FF9800;
                    color: white;
                    padding: 15px 30px;
                    border: none;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 30px;
                ">
                    Try Again
                </button>
            </div>
        `;
    });

    socket.on('simulationStopped', (data) => {
        // Show simulation stopped screen
        document.body.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background-color: #f0f0f0;
                font-family: Arial, sans-serif;
                text-align: center;
                padding: 20px;
            ">
                <h1 style="color: #f44336; font-size: 48px; margin-bottom: 20px;">
                    Simulation Stopped
                </h1>
                <p style="font-size: 24px; color: #666; margin-bottom: 30px;">
                    ${data.message}
                </p>
                <p style="font-size: 18px; color: #888;">
                    Please wait for the administrator to start a new simulation.
                </p>
                <button onclick="location.reload()" style="
                    background-color: #4CAF50;
                    color: white;
                    padding: 15px 30px;
                    border: none;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 30px;
                ">
                    Refresh Page
                </button>
            </div>
        `;
    });

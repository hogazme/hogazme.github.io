import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import adminData from './admin-data.json' with { type: "json" };
import { writeFile } from 'fs/promises';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROAD_CONFIG = require('./public/shared/roads.cjs');

// Necessary configuration to handle __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server configuration
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json())
let AdminParams  = adminData;
// Port configuration
const PORT = process.env.PORT || 3000;
// added later
// const path = require('path');
// app.use(require('express').static(path.join(__dirname, 'public')));
// Simulation state
let isSimulationRunning = false;
let gameStartTime = null;

// Add charging station generation
const generateChargingStations = (count, minChargeTime, maxChargeTime, minPrice, maxPrice) => {
    const stations = [];
    const roads = ROAD_CONFIG.toRectangles();
    const stationSize = 15;
    const mapWidth = 1000; // Updated to full map width
    const mapHeight = 1000; // Updated to full map height
    const parkingLotSize = 30; // Standardized size for all parking lots

    const inBounds = (rect) => {
        return rect.x >= 0 && rect.x + rect.width <= mapWidth && rect.y >= 0 && rect.y + rect.height <= mapHeight;
    };

    const overlapsRoad = (rect) => {
        for (const road of roads) {
            if (rect.x < road.left + road.width && rect.x + rect.width > road.left &&
                rect.y < road.top + road.height && rect.y + rect.height > road.top) {
                return true;
            }
        }
        return false;
    };

    const rectsOverlap = (r1, r2) => {
        return r1.x < r2.x + r2.width && r1.x + r1.width > r2.x &&
               r1.y < r2.y + r2.height && r1.y + r1.height > r2.y;
    };

    const placedRects = [];
    const placedParkingLots = [];
    const playerStart = { x: 0, y: 235 };
    const minDistanceFromStart = 30; // Minimum distance in pixels from player start

    for (let i = 0; i < count; i++) {
        let placed = false;
        for (let attempt = 0; attempt < 100 && !placed; attempt++) {
            // Randomly pick a road for the station
            const road = roads[Math.floor(Math.random() * roads.length)];
            const top = road.top + Math.random() * (road.height - stationSize);
            const left = road.left + Math.random() * (road.width - stationSize);
            const stationRect = { x: left, y: top, width: stationSize, height: stationSize };
            if (!inBounds(stationRect)) continue;
            // Strict non-overlap check for station icons
            if (placedRects.some(r => rectsOverlap(r, stationRect))) continue;
            // Check distance from player start
            const stationCenterX = left + stationSize / 2;
            const stationCenterY = top + stationSize / 2;
            const dx = stationCenterX - playerStart.x;
            const dy = stationCenterY - playerStart.y;
            if (Math.sqrt(dx * dx + dy * dy) < minDistanceFromStart) continue;
            // Try to find a valid parking lot anywhere off-road
            let parkingLot = null;
            let parkingLotRect = null;
            for (let lotAttempt = 0; lotAttempt < 100; lotAttempt++) {
                const lotX = Math.random() * (mapWidth - parkingLotSize);
                const lotY = Math.random() * (mapHeight - parkingLotSize);
                const lotRect = { x: lotX, y: lotY, width: parkingLotSize, height: parkingLotSize };
                if (!inBounds(lotRect)) continue;
                if (overlapsRoad(lotRect)) continue;
                if (placedParkingLots.some(r => rectsOverlap(r, lotRect))) continue;
                parkingLot = { x: lotX, y: lotY };
                parkingLotRect = lotRect;
                break;
            }
            if (!parkingLot) continue;
            const minT = Math.ceil(minChargeTime / 10) * 10;
            const maxT = Math.floor(maxChargeTime / 10) * 10;
            const step = 10;
            const chargeTime = Math.floor(Math.random() * ((maxT - minT) / step + 1)) * step + minT;
            const price = Math.floor(Math.random() * (maxPrice - minPrice + 1)) + minPrice;
            stations.push({
                id: `station-${i}`,
                top: Math.round(top),
                left: Math.round(left),
                cost: price,
                sockets: Math.floor(Math.random() * 4) + 1,
                activeChargers: 0,
                chargeTime,
                parkingLot // for debugging/optional use
            });
            placedRects.push(stationRect);
            placedParkingLots.push(parkingLotRect);
            placed = true;
        }
    }
    return stations;
};

// On server start, use AdminParams for initial game state
const parseAdminParams = (params) => ({
    stationCount: Number(params.stationCount) || 5,
    playerBudget: Number(params.playerBudget) || 100,
    minChargeTime: Number(params.minChargeTime) || 30,
    maxChargeTime: Number(params.maxChargeTime) || 90,
    minPrice: Number(params.minPrice) || 10,
    maxPrice: Number(params.maxPrice) || 35
});
const parsedParams = parseAdminParams(AdminParams);
// Persistent player assignments to maintain player names across refreshes
const persistentPlayerAssignments = new Map(); // Maps player name to socket ID
const availablePlayerSlots = new Set(); // Available player numbers (1, 2, 3, etc.)

// Function to load custom station configuration
const loadCustomStations = () => {
    try {
        if (fs.existsSync('./station-config.json')) {
            const config = JSON.parse(fs.readFileSync('./station-config.json', 'utf8'));
            const stations = config.stations || [];
            
            // Ensure all custom stations have the activeChargers property initialized
            stations.forEach(station => {
                if (station.activeChargers === undefined) {
                    station.activeChargers = 0;
                }
            });
            
            return stations;
        }
    } catch (error) {
        console.error('Error loading custom station configuration:', error);
    }
    return [];
};

const gameState = {
    players: new Map(),
    playerCount: 0,
    stations: loadCustomStations().length > 0 ? loadCustomStations() : generateChargingStations(
        parsedParams.stationCount,
        parsedParams.minChargeTime,
        parsedParams.maxChargeTime,
        parsedParams.minPrice,
        parsedParams.maxPrice
    ),
    chargingPlayers: new Map()
};



// MySQL configuration
let mysqlConnection = null;
const configureMySQL = async () => {
    try {
        mysqlConnection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            user: process.env.MYSQL_USER || 'root',
            database: process.env.MYSQL_DATABASE || 'pathTracker',
            password: process.env.MYSQL_PASSWORD || '',
            connectTimeout: 5000,
            acquireTimeout: 5000,
            timeout: 5000
        });
        console.log('MySQL connection successful');
    } catch (err) {
        console.error('MySQL connection error:', err.message);
        console.log('Server will continue without MySQL database connection');
        mysqlConnection = null;
    }
};

// Call MySQL configuration (but don't let it crash the server)
configureMySQL().catch(err => {
    console.error('MySQL configuration failed, continuing without database:', err.message);
});

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Function to register positions in MySQL
const insertPlayerPosition = async (playerId, positionX, positionY) => {
    // Skip if no MySQL connection
    if (!mysqlConnection) {
        return;
    }
    
    try {
        const query = `INSERT INTO player_positions (player_id, position_x, position_y) VALUES (?, ?, ?)`;
        await mysqlConnection.execute(query, [playerId, positionX, positionY]);
        console.log(`Datos insertados: Jugador ${playerId}, X=${positionX}, Y=${positionY}`);
    } catch (error) {
        console.error('Error al registrar posición en MySQL:', error.message);
    }
};

// Helper functions
function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Function to get random spawn position at entry points
function getRandomSpawnPosition() {
    const spawnPoints = ROAD_CONFIG.entryPoints.map(ep => ({
        x: ep.x, y: ep.y, pointNumber: ep.pointNumber, name: ep.name
    }));

    return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
}

// Function to get or assign a persistent player slot
function getOrAssignPlayerSlot(socketId) {
    // Check if this socket ID already has a persistent assignment
    for (const [playerName, assignedSocketId] of persistentPlayerAssignments.entries()) {
        if (assignedSocketId === socketId) {
            return playerName;
        }
    }
    
    // Find the lowest available player number
    let playerNumber = 1;
    while (persistentPlayerAssignments.has(`Player ${playerNumber}`)) {
        playerNumber++;
    }
    
    const playerName = `Player ${playerNumber}`;
    persistentPlayerAssignments.set(playerName, socketId);
    return playerName;
}

// Function to clean up disconnected players
function cleanupDisconnectedPlayers() {
    const connectedSocketIds = new Set();
    for (const [socket] of io.sockets.sockets) {
        connectedSocketIds.add(socket);
    }
    
    // Remove assignments for disconnected players
    for (const [playerName, socketId] of persistentPlayerAssignments.entries()) {
        if (!connectedSocketIds.has(socketId)) {
            persistentPlayerAssignments.delete(playerName);
        }
    }
}

// Store the game start time
// Game start time is now controlled by simulation state

// Handle socket connections
io.on('connection', (socket) => {
    console.log('Connection established:', socket.id);
    

    
    // Prevent new players from joining during simulation
    if (isSimulationRunning) {
        socket.emit('simulationInProgress', {
            message: 'A simulation is currently in progress. Please wait for it to finish before joining.'
        });
        socket.disconnect();
        return;
    }
    
    // Parse AdminParams every time a new player connects
    const parsedParams = parseAdminParams(AdminParams);
    
    // Get or assign persistent player slot
    const playerName = getOrAssignPlayerSlot(socket.id);
    console.log(`Player connection: ${playerName} (Socket: ${socket.id})`);
    
    // Get random spawn position at one of the entry points
    const spawnPosition = getRandomSpawnPosition();
    
    // Check if this is a reconnection (player name already assigned)
    const isReconnection = persistentPlayerAssignments.has(playerName);
    
    if (isReconnection) {
        // This is a reconnection - update the socket ID mapping
        persistentPlayerAssignments.set(playerName, socket.id);
        
        // Check if player already exists in game state
        const existingPlayer = gameState.players.get(socket.id);
        if (existingPlayer) {
            // Update socket ID for existing player
            existingPlayer.id = socket.id;
        } else {
            // Re-add player to game state with their persistent name
            gameState.playerCount++;
            gameState.players.set(socket.id, {
                id: socket.id,
                name: playerName,
                positionX: spawnPosition.x,
                positionY: spawnPosition.y,
                energy: 100,
                money: parsedParams.playerBudget,
                color: `hsl(${Math.random() * 360}, 70%, 50%)`,
                isCharging: false,
                chargingStationId: null
            });
        }
    } else {
        // This is a new player
        gameState.playerCount++;
        gameState.players.set(socket.id, {
            id: socket.id,
            name: playerName,
            positionX: spawnPosition.x,
            positionY: spawnPosition.y,
            energy: 100,
            money: parsedParams.playerBudget,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            isCharging: false,
            chargingStationId: null
        });
    }

    // Send initial game state to new player
    socket.emit('gameState', {
        playerId: socket.id,
        players: Array.from(gameState.players.values()),
        stations: gameState.stations
    });

    // Broadcast new player to all other players
    socket.broadcast.emit('playerJoined', gameState.players.get(socket.id));

    // Update charging validation event handler
    socket.on('validateCharging', (data) => {
        console.log('Validating charging request:', data); // Add logging
        const station = gameState.stations.find(s => s.id === data.stationId);
        const player = gameState.players.get(socket.id);
        
        if (!station || !player) {
            console.log('Invalid station or player:', { station, player }); // Add logging
            socket.emit('chargingValidation', {
                stationId: data.stationId,
                canCharge: false,
                message: 'Invalid station or player'
            });
            return;
        }
        
        // Check if player has enough money
        if (player.money < station.cost) {
            console.log('Not enough money:', { playerMoney: player.money, stationCost: station.cost }); // Add logging
            socket.emit('chargingValidation', {
                stationId: data.stationId,
                canCharge: false,
                message: 'Not enough money'
            });
            return;
        }
        
        // Check if station has available sockets
        const currentChargers = station.activeChargers || 0;
        if (currentChargers >= station.sockets) {
            console.log('All sockets in use:', { currentChargers, maxSockets: station.sockets }); // Add logging
            socket.emit('chargingValidation', {
                stationId: data.stationId,
                canCharge: false,
                message: 'All sockets are in use'
            });
            return;
        }
        
        // Validation passed
        console.log('Charging validation passed'); // Add logging
        socket.emit('chargingValidation', {
            stationId: data.stationId,
            canCharge: true,
            currentChargers: currentChargers
        });
    });

    // Update charging start event handler
    socket.on('chargingStart', (data) => {
        console.log('Charging start request:', data); // Add logging
        const station = gameState.stations.find(s => s.id === data.stationId);
        const player = gameState.players.get(socket.id);
        
        if (station && player) {
            console.log('Starting charge for player:', { playerId: socket.id, stationId: data.stationId }); // Add logging
            // Deduct money from player
            player.money -= station.cost;
            player.isCharging = true;
            player.chargingStationId = data.stationId;
            
            // Update station state
            station.activeChargers = (station.activeChargers || 0) + 1;
            
            // Broadcast to all clients
            io.emit('chargingStart', {
                stationId: data.stationId,
                playerId: socket.id,
                currentChargers: station.activeChargers,
                positionX: data.positionX,
                positionY: data.positionY,
                isCharging: true
            });
        }
    });

    // Update charging stop event handler
    socket.on('chargingStop', (data) => {
        const station = gameState.stations.find(s => s.id === data.stationId);
        const player = gameState.players.get(socket.id);
        
        if (station && player) {
            // Update player state
            player.isCharging = false;
            player.chargingStationId = null;
            
            // Update station state
            station.activeChargers = Math.max(0, (station.activeChargers || 0) - 1);
            
            // Broadcast to all clients
            io.emit('chargingStop', {
                stationId: data.stationId,
                playerId: socket.id,
                currentChargers: station.activeChargers,
                positionX: data.positionX,
                positionY: data.positionY,
                isCharging: false
            });
        }
    });

    // Update charging complete event handler
    socket.on('chargingComplete', (data) => {
        const station = gameState.stations.find(s => s.id === data.stationId);
        const player = gameState.players.get(socket.id);
        
        if (station && player) {
            // Update player state
            player.isCharging = false;
            player.chargingStationId = null;
            player.energy = 100; // Reset energy to full
            
            // Update station state
            station.activeChargers = Math.max(0, (station.activeChargers || 0) - 1);
            
            // Broadcast to all clients
            io.emit('chargingComplete', {
                stationId: data.stationId,
                playerId: socket.id,
                currentChargers: station.activeChargers,
                positionX: data.positionX,
                positionY: data.positionY,
                isCharging: false
            });
        }
    });

    // Handle player movement and log event
    socket.on('movePlayer', (data) => {
        const player = gameState.players.get(socket.id);
        if (player && !player.isCharging) {
            player.positionX = data.positionX;
            player.positionY = data.positionY;
            player.energy = data.energy;
            io.emit('playerMoved', {
                id: socket.id,
                positionX: data.positionX,
                positionY: data.positionY,
                energy: data.energy,
                isCharging: false
            });
            
            // Only log movement events for start and stop actions
            if ((data.action === 'start' || data.action === 'stop') && isSimulationRunning && gameStartTime) {
                const logEntry = {
                    type: 'move',
                    playerId: player.name, // Use display name
                    positionX: data.positionX,
                    positionY: data.positionY,
                    energy: data.energy,
                    arrowKey: data.arrowKey || null, // Log arrow key
                    action: data.action, // Log whether this is start or stop
                    timeStamp: ((data.timestamp || Date.now()) - gameStartTime) / 1000 // Seconds since game start
                };
                fs.appendFile('player_events.log', JSON.stringify(logEntry) + '\n', err => { if (err) console.error(err); });
            }
        }
    });

    // Handle button clicks and log event
    socket.on('buttonClick', (data) => {
        if (isSimulationRunning && gameStartTime) {
            const player = gameState.players.get(socket.id);
            const logEntry = {
                type: 'buttonClick',
                playerId: player ? player.name : (data.playerId || socket.id), // Use display name
                button: data.button,
                infoType: data.infoType || null, // Add infoType to specify which button was clicked
                stationId: data.stationId || null,
                timeStamp: ((data.timestamp || Date.now()) - gameStartTime) / 1000 // Seconds since game start
            };
            fs.appendFile('player_events.log', JSON.stringify(logEntry) + '\n', err => { if (err) console.error(err); });
        }
    });

    // Handle item pickup events
    socket.on('itemPickup', (data) => {
        if (isSimulationRunning && gameStartTime) {
            const player = gameState.players.get(socket.id);
            const logEntry = {
                type: 'itemPickup',
                playerId: player ? player.name : data.playerId,
                pickupPoint: data.pickupPoint,
                pickupPointName: `Entry Point ${data.pickupPoint}`,
                destinationPoint: data.destinationPoint,
                destinationPointName: `Entry Point ${data.destinationPoint}`,
                timeStamp: ((data.timestamp || Date.now()) - gameStartTime) / 1000
            };
            fs.appendFile('player_events.log', JSON.stringify(logEntry) + '\n', err => { if (err) console.error(err); });
        }
    });

    // Handle item delivery events
    socket.on('itemDelivery', (data) => {
        const player = gameState.players.get(socket.id);
        if (player) {
            player.money += data.reward; // Update server-side money
        }
        if (isSimulationRunning && gameStartTime) {
            const logEntry = {
                type: 'itemDelivery',
                playerId: player ? player.name : data.playerId,
                deliveryPoint: data.deliveryPoint,
                deliveryPointName: `Entry Point ${data.deliveryPoint}`,
                reward: data.reward,
                timeStamp: ((data.timestamp || Date.now()) - gameStartTime) / 1000
            };
            fs.appendFile('player_events.log', JSON.stringify(logEntry) + '\n', err => { if (err) console.error(err); });
        }
    });

    // Handle initial item assignment events
    socket.on('itemAssigned', (data) => {
        if (isSimulationRunning && gameStartTime) {
            const player = gameState.players.get(socket.id);
            const logEntry = {
                type: 'itemAssigned',
                playerId: player ? player.name : data.playerId,
                destinationPoint: data.destinationPoint,
                destinationPointName: data.destinationPointName,
                timeStamp: ((data.timestamp || Date.now()) - gameStartTime) / 1000
            };
            fs.appendFile('player_events.log', JSON.stringify(logEntry) + '\n', err => { if (err) console.error(err); });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const disconnectedPlayer = gameState.players.get(socket.id);
        console.log(`Player disconnected: ${disconnectedPlayer ? disconnectedPlayer.name : 'Unknown'} (Socket: ${socket.id})`);
        
        // Handle player disconnection
        if (disconnectedPlayer && disconnectedPlayer.isCharging) {
            const station = gameState.stations.find(s => s.id === disconnectedPlayer.chargingStationId);
            if (station) {
                station.activeChargers = Math.max(0, station.activeChargers - 1);
                const chargingPlayers = gameState.chargingPlayers.get(station.id);
                if (chargingPlayers) {
                    chargingPlayers.delete(socket.id);
                }
                io.emit('chargingStop', {
                    stationId: station.id,
                    currentChargers: station.activeChargers,
                    playerId: socket.id
                });
            }
        }
        
        // Remove from game state but keep persistent assignment for potential reconnection
        gameState.players.delete(socket.id);
        gameState.playerCount--;
        
        // Clean up persistent assignments for truly disconnected players
        setTimeout(() => {
            cleanupDisconnectedPlayers();
        }, 5000); // Wait 5 seconds before cleaning up to allow for reconnection
        
        io.emit('playerLeft', socket.id);
    });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


// Endpoint to save custom station configuration
app.post('/save-station-config', (req, res) => {
    try {
        const { stations } = req.body;
        const config = {
            stations: stations,
            timestamp: new Date().toISOString()
        };
        
        // Save to file
        fs.writeFileSync('./station-config.json', JSON.stringify(config, null, 2));
        
        // Update the game state with new stations
        gameState.stations = stations;
        
        // Notify all connected clients about the station update
        io.emit('stationsUpdated', { stations: stations });
        
        res.json({ success: true, message: 'Station configuration saved successfully' });
    } catch (error) {
        console.error('Error saving station configuration:', error);
        res.status(500).json({ success: false, message: 'Error saving configuration' });
    }
});

// Endpoint to load custom station configuration
app.get('/load-station-config', (req, res) => {
    try {
        if (fs.existsSync('./station-config.json')) {
            const config = JSON.parse(fs.readFileSync('./station-config.json', 'utf8'));
            res.json(config);
        } else {
            res.json({ stations: [] });
        }
    } catch (error) {
        console.error('Error loading station configuration:', error);
        res.status(500).json({ success: false, message: 'Error loading configuration' });
    }
});



app.get('/admin-parameters',(req, res) => {
    res.status(200).send(AdminParams);
})

// In the /admin-parameters PUT handler, parse and save only the four relevant fields as numbers
app.put('/admin-parameters', async (req, res) => {
    try {
        const { stationCount, playerBudget, minChargeTime, maxChargeTime, minPrice, maxPrice } = req.body;
        // Validate and parse
        const newParams = {
            stationCount: Number(stationCount),
            playerBudget: Number(playerBudget),
            minChargeTime: Number(minChargeTime),
            maxChargeTime: Number(maxChargeTime),
            minPrice: Number(minPrice),
            maxPrice: Number(maxPrice)
        };
        if (
            !newParams.stationCount ||
            !newParams.playerBudget ||
            !newParams.minChargeTime ||
            !newParams.maxChargeTime ||
            !newParams.minPrice ||
            !newParams.maxPrice ||
            newParams.stationCount < 5 ||
            newParams.playerBudget < 50 ||
            newParams.minChargeTime < 10 ||
            newParams.maxChargeTime < 60 ||
            newParams.minChargeTime > newParams.maxChargeTime ||
            newParams.minPrice < 10 ||
            newParams.maxPrice < 35 ||
            newParams.minPrice > newParams.maxPrice
        ) {
            return res.status(400).json({ message: 'bad request' });
        }
        // Save to file
        await writeFile('./admin-data.json', JSON.stringify(newParams));
        AdminParams = newParams;
        // Regenerate stations for the next game
        gameState.stations = generateChargingStations(
            newParams.stationCount,
            newParams.minChargeTime,
            newParams.maxChargeTime,
            newParams.minPrice,
            newParams.maxPrice
        );
        return res.status(200).json(newParams);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'internal server error' });
    }
});

// Simulation control endpoints
app.get('/simulation-status', (req, res) => {
    res.json({ isRunning: isSimulationRunning });
});

app.post('/simulation-control', (req, res) => {
    const { action } = req.body;
    
    if (action === 'start') {
        if (isSimulationRunning) {
            return res.json({ success: false, message: 'Simulation is already running' });
        }
        
        isSimulationRunning = true;
        gameStartTime = Date.now();
        
        // Reset existing players' game state but keep their names and assign new starting positions
        const updatedPlayers = [];
        gameState.players.forEach(player => {
            const spawnPosition = getRandomSpawnPosition();
            
            // Force reset all charging-related state
            player.positionX = spawnPosition.x;
            player.positionY = spawnPosition.y;
            player.energy = 100;
            player.money = AdminParams.playerBudget;
            player.isCharging = false;
            player.chargingStationId = null;
            
            // Store updated player info for client updates
            updatedPlayers.push({
                id: player.id,
                name: player.name,
                positionX: player.positionX,
                positionY: player.positionY,
                energy: player.energy,
                money: player.money
            });
            
            // Log player starting point (keeping their existing name)
            const startLogEntry = {
                type: 'playerStart',
                playerId: player.name, // Keep existing name
                startingPoint: spawnPosition.pointNumber,
                startingPointName: spawnPosition.name,
                positionX: spawnPosition.x,
                positionY: spawnPosition.y,
                timeStamp: (Date.now() - gameStartTime) / 1000
            };
            fs.appendFile('player_events.log', JSON.stringify(startLogEntry) + '\n', err => {
                if (err) console.error(err);
            });
        });
        
        // Clear all charging station states
        gameState.stations.forEach(station => {
            station.activeChargers = 0; // Reset server-side charging count
            // Reset any charging activity at stations
            io.emit('chargingStop', {
                stationId: station.id,
                currentChargers: 0,
                playerId: null,
                forced: true // Indicate this is a forced reset
            });
        });
        
        // Clear the charging players map to remove all "ghost" occupants
        gameState.chargingPlayers.clear();
        
        // Notify all clients that simulation started with updated player positions
        io.emit('simulationStarted', {
            message: 'Game simulation has started!',
            gameStartTime: gameStartTime,
            players: updatedPlayers
        });
        

        
        res.json({ success: true, message: 'Simulation started successfully!' });
        
    } else if (action === 'stop') {
        if (!isSimulationRunning) {
            return res.json({ success: false, message: 'Simulation is not running' });
        }
        
        isSimulationRunning = false;
        
        // Notify all clients that simulation stopped
        io.emit('simulationStopped', {
            message: 'Game simulation has been stopped by admin.'
        });
        
        res.json({ success: true, message: 'Simulation stopped successfully!' });
        
    } else {
        res.json({ success: false, message: 'Invalid action' });
    }
});

// Start the server
// const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});

// server.listen(PORT, '0.0.0.0', () => {
//     console.log(`Servidor corriendo en http://localhost:${PORT}`);
//     console.log(`También disponible en la red local en: http://[TU-IP]:${PORT}`);
//     console.log(`Para encontrar tu IP, ejecuta: 'ifconfig' (Mac/Linux) o 'ipconfig' (Windows)`);
// });



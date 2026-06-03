const ROAD_CONFIG = {
    mapSize: 1000,
    roadWidth: 30,
    verticalRoads: [
        { left: 0 },
        { left: 115 },
        { left: 235 },
        { left: 355 },
        { left: 470 },
        { left: 615 },
        { left: 735 },
        { left: 855 },
        { left: 970 },
    ],
    horizontalRoads: [
        { top: 0 },
        { top: 115 },
        { top: 235 },
        { top: 355 },
        { top: 470 },
        { top: 615 },
        { top: 735 },
        { top: 855 },
        { top: 970 },
    ],
    entryPoints: [
        { id: 'top', x: 485, y: -15, pointNumber: 1, name: 'Entry Point 1', color: '#FF9800' },
        { id: 'right', x: 1015, y: 485, pointNumber: 2, name: 'Entry Point 2', color: '#4CAF50' },
        { id: 'bottom', x: 485, y: 1015, pointNumber: 3, name: 'Entry Point 3', color: '#2196F3' },
        { id: 'left', x: -15, y: 485, pointNumber: 4, name: 'Entry Point 4', color: '#FF5722' },
    ],
};

ROAD_CONFIG.toRectangles = function () {
    const rects = [];
    for (const v of this.verticalRoads) {
        rects.push({ top: 0, left: v.left, width: this.roadWidth, height: this.mapSize });
    }
    for (const h of this.horizontalRoads) {
        rects.push({ top: h.top, left: 0, width: this.mapSize, height: this.roadWidth });
    }
    rects.push({ top: 485, left: -30, width: 30, height: 30 });
    rects.push({ top: 485, left: 1000, width: 30, height: 30 });
    rects.push({ top: -30, left: 485, width: 30, height: 30 });
    rects.push({ top: 1000, left: 485, width: 30, height: 30 });
    return rects;
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ROAD_CONFIG;
} else if (typeof window !== 'undefined') {
    window.ROAD_CONFIG = ROAD_CONFIG;
}

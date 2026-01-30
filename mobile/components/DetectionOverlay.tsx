import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Circle } from 'react-native-svg';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Detection {
    class: string;
    score: number;
    x: number;
    y: number;
    width: number;
    height: number;
    proximity?: 'close' | 'medium' | 'far';
    direction?: 'left' | 'center' | 'right';
    isShape?: boolean;
    isText?: boolean;
}

interface DetectionOverlayProps {
    detections: Detection[];
    frameWidth: number;
    frameHeight: number;
}

function getProximityColor(proximity?: 'close' | 'medium' | 'far'): string {
    switch (proximity) {
        case 'close': return '#ef4444';  // Red for close
        case 'medium': return '#f59e0b'; // Amber for medium
        case 'far': return '#22c55e';    // Green for far
        default: return '#3b82f6';       // Blue default
    }
}

export default function DetectionOverlay({ detections, frameWidth, frameHeight }: DetectionOverlayProps) {
    // Calculate scale factors to map detection coordinates to screen coordinates
    const scaleX = SCREEN_WIDTH / frameWidth;
    const scaleY = SCREEN_HEIGHT / frameHeight;

    return (
        <View style={styles.container} pointerEvents="none">
            <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT} style={styles.svg}>
                {detections.map((detection, index) => {
                    const x = detection.x * scaleX;
                    const y = detection.y * scaleY;
                    const width = detection.width * scaleX;
                    const height = detection.height * scaleY;
                    const color = getProximityColor(detection.proximity);

                    // For shapes, draw appropriate shape outline
                    if (detection.isShape) {
                        const shapeType = detection.class.toLowerCase();
                        if (shapeType.includes('circle') || shapeType.includes('oval')) {
                            return (
                                <Circle
                                    key={`detection-${index}`}
                                    cx={x + width / 2}
                                    cy={y + height / 2}
                                    r={Math.min(width, height) / 2}
                                    stroke={color}
                                    strokeWidth={3}
                                    fill="transparent"
                                />
                            );
                        }
                    }

                    // Default: draw rectangle (thick stroke so detection boxes are clearly visible)
                    return (
                        <Rect
                            key={`detection-${index}`}
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                            stroke={color}
                            strokeWidth={detection.isText ? 2 : 5}
                            strokeDasharray={detection.isText ? "5,5" : undefined}
                            fill="transparent"
                        />
                    );
                })}
            </Svg>

            {/* Labels */}
            {detections.map((detection, index) => {
                const x = detection.x * scaleX;
                const y = detection.y * scaleY;
                const color = getProximityColor(detection.proximity);

                return (
                    <View
                        key={`label-${index}`}
                        style={[
                            styles.label,
                            {
                                left: x,
                                top: y > 32 ? y - 30 : y + 4,
                                backgroundColor: color,
                            },
                        ]}
                    >
                        <Text style={styles.labelText} numberOfLines={1}>
                            {detection.class}
                            {detection.direction != null && ` · ${detection.direction}`}
                            {detection.proximity != null && ` · ${detection.proximity}`}
                        </Text>
                        {!detection.isText && (
                            <Text style={styles.confidenceText}>
                                {Math.round(detection.score * 100)}%
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    svg: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    label: {
        position: 'absolute',
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        maxWidth: 220,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.3)',
    },
    labelText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    confidenceText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 10,
        fontWeight: '600',
    },
});

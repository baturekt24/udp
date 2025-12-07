import { Buffer } from 'buffer';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import dgram from 'react-native-udp';

// --- CRITICAL FIX: These values MUST match your C code constants.h ---
const ROVER_IP = '192.168.1.7';
const ROVER_PORT = 6102;

const ROVER_SSID_PREFIX = 'URC-ITU ROVER TEAM';
const ROVER_SSID_PASS = 'iturover123';

// ⚠️ FIXED: OpMode values (removed extra 0s)
const OP_MODE_DRIVE_ACTIVE = 0x01;
const OP_MODE_NAIM_ACTIVE = 0x02;
const OP_MODE_SCIENCE_DATA = 0x04;
const OP_MODE_REQUEST_GPS = 0x08;
const OP_MODE_LED_DATA = 0x10;

const PACKET_SIZE = 19; // Base packet size

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [timestamp, setTimestamp] = useState(0);
  const [statusLog, setStatusLog] = useState([]);
  
  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [availableNetworks, setAvailableNetworks] = useState([]);
  const [currentSSID, setCurrentSSID] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  const [controlState, setControlState] = useState({
    lin_dir: 1,
    lin_vel: 0,
    rot_dir: 0,
    rot_vel: 0,
    arm_axes: [5, 5, 5, 5, 5, 5],
  });

  // --- INITIALIZATION ---
  useEffect(() => {
    requestPermissions();
    getCurrentWifi();
  }, []);

  useEffect(() => {
    initializeSocket();
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimestamp((t) => (t + 1) & 0xFFFF);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Heartbeat - send idle packet every 2 seconds
  useEffect(() => {
    if (!connected || !socket) return;

    const pingInterval = setInterval(() => {
      const pingPacket = buildBinaryPacket({
        lin_dir: 1,
        lin_vel: 0,
        rot_dir: 0,
        rot_vel: 0,
        arm_axes: [5, 5, 5, 5, 5, 5],
      });
      
      socket.send(pingPacket, 0, pingPacket.length, ROVER_PORT, ROVER_IP, (err) => {
        if (err) {
          // Silent error to avoid log spam
        }
      });
    }, 2000);

    return () => clearInterval(pingInterval);
  }, [connected, socket, timestamp]);

  // --- LOGGING ---
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setStatusLog((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]);
  };

  const getSignalStrength = (level) => {
    if (level > -50) return '▂▃▄▅▆';
    if (level > -60) return '▂▃▄▅';
    if (level > -70) return '▂▃▄';
    if (level > -80) return '▂▃';
    return '▂';
  };

  // --- WIFI FUNCTIONS ---
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);

        const allGranted = Object.values(granted).every(
          (p) => p === PermissionsAndroid.RESULTS.GRANTED
        );

        if (allGranted) {
          addLog('Location permissions granted');
        } else {
          addLog('Location permissions denied');
          Alert.alert('Permission Required', 'Wi-Fi scanning requires location permissions.');
        }
      } catch (err) {
        addLog(`Permission error: ${err.message}`);
      }
    }
  };

  const getCurrentWifi = async () => {
    try {
      const ssid = await WifiManager.getCurrentWifiSSID();
      setCurrentSSID(ssid);
      addLog(`Connected to: ${ssid}`);
    } catch (error) {
      addLog(`Failed to get current WiFi: ${error.message}`);
      setCurrentSSID('');
    }
  };

  const scanWifiNetworks = async () => {
    setIsScanning(true);
    addLog('Scanning...');
    try {
      const networks = await WifiManager.loadWifiList();
      const sortedNetworks = networks.sort((a, b) => {
        const aIsRover = a.SSID.includes(ROVER_SSID_PREFIX);
        const bIsRover = b.SSID.includes(ROVER_SSID_PREFIX);
        if (aIsRover && !bIsRover) return -1;
        if (!aIsRover && bIsRover) return 1;
        return b.level - a.level;
      });
      setAvailableNetworks(sortedNetworks);
      addLog(`Found ${networks.length} networks`);
    } catch (error) {
      addLog(`Scan failed: ${error.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const connectToWifi = async (ssid) => {
    if (ssid.includes(ROVER_SSID_PREFIX)) {
      try {
        addLog(`Connecting to ${ssid}...`);
        await WifiManager.connectToProtectedSSID(ssid, ROVER_SSID_PASS, false);
        addLog('Connection attempt sent.');
        
        setTimeout(async () => {
          const connectedSSID = await WifiManager.getCurrentWifiSSID();
          if (connectedSSID === ssid) {
            setCurrentSSID(ssid);
            addLog(`Successfully connected to ${ssid}`);
            Alert.alert('Success', `Connected to ${ssid}`);
            setWifiModalVisible(false);
          } else {
            addLog(`Connection failed (Current: ${connectedSSID})`);
            Alert.alert('Failed', 'Could not connect to network');
          }
        }, 5000);
      } catch (error) {
        addLog(`Connection error: ${error.message}`);
        Alert.alert('Error', `Failed to connect: ${error.message}`);
      }
    } else {
      Alert.prompt('Connect to WiFi', `Enter password for ${ssid}`, 
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Connect', 
            onPress: async (password) => {
              try {
                await WifiManager.connectToProtectedSSID(ssid, password, false);
                addLog(`Connecting to ${ssid}...`);
              } catch (error) {
                Alert.alert('Error', `Failed to connect: ${error.message}`);
              }
            }
          }
        ],
        'secure-text'
      );
    }
  };

  // --- UDP FUNCTIONS ---
  const initializeSocket = () => {
    try {
      if (socket) {
        socket.close();
      }
      const newSocket = dgram.createSocket('udp4');
      newSocket.bind(0);
      
      newSocket.on('listening', () => { addLog('UDP Socket initialized'); });

      newSocket.on('message', (data, rinfo) => {
        const hexData = Buffer.from(data).toString('hex');
        addLog(`RECEIVED: ${hexData} from ${rinfo.address}:${rinfo.port}`);
      });

      newSocket.on('error', (err) => { addLog(`Socket error: ${err.message}`); });

      setSocket(newSocket);
      setConnected(true);
    } catch (error) {
      addLog(`Failed to initialize socket: ${error.message}`);
    }
  };

  /**
   * ⚠️ CRITICAL FIX: This function now exactly matches the C code logic
   * from udp_server.c's processing_thread and message formatting functions
   */
  const buildBinaryPacket = (currentState) => {
    const buffer = Buffer.alloc(PACKET_SIZE);
    let offset = 0;

    // 1. Timestamp (2 bytes, binary, Big Endian)
    buffer.writeUInt16BE(timestamp & 0xFFFF, offset);
    offset += 2;

    // 2. OpMode (2 bytes, binary, Big Endian)
    // ⚠️ FIXED: Always include REQUEST_GPS and LED_DATA like C code does
    let op_mode = OP_MODE_REQUEST_GPS | OP_MODE_LED_DATA;
    
    // Add DRIVE_ACTIVE if there's any movement
    if (currentState.lin_vel > 0 || currentState.rot_vel > 0) {
      op_mode |= OP_MODE_DRIVE_ACTIVE;
    }
    
    // Add NAIM_ACTIVE if any arm axis is not neutral (5)
    if (currentState.arm_axes.some(axis => axis !== 5)) {
      op_mode |= OP_MODE_NAIM_ACTIVE;
    }
    
    buffer.writeUInt16BE(op_mode, offset);
    offset += 2;

    // 3. Rotation Direction + Velocity (4 bytes, ALL ASCII)
    // ⚠️ FIXED: Max rotation velocity is 399, not 999
    const rot_dir = currentState.rot_dir & 0xFF;
    const vel_rot = Math.min(399, Math.max(0, Math.floor(currentState.rot_vel)));
    
    buffer[offset++] = 0x30 + rot_dir;                         // '0' or '1'
    buffer[offset++] = 0x30 + Math.floor(vel_rot / 100);       // hundreds
    buffer[offset++] = 0x30 + Math.floor((vel_rot % 100) / 10); // tens
    buffer[offset++] = 0x30 + (vel_rot % 10);                  // ones

    // 4. Linear Direction + Velocity (5 bytes, ALL ASCII)
    const lin_dir = currentState.lin_dir & 0xFF;
    const vel_lin = Math.min(3999, Math.max(0, Math.floor(currentState.lin_vel)));
    
    buffer[offset++] = 0x30 + lin_dir;                           // '0' or '1'
    buffer[offset++] = 0x30 + Math.floor(vel_lin / 1000);        // thousands
    buffer[offset++] = 0x30 + Math.floor((vel_lin % 1000) / 100); // hundreds
    buffer[offset++] = 0x30 + Math.floor((vel_lin % 100) / 10);  // tens
    buffer[offset++] = 0x30 + (vel_lin % 10);                    // ones

    // 5. Arm Axes (6 bytes, ALL ASCII, range 0-9)
    for (let i = 0; i < 6; i++) {
      const intensity = Math.min(9, Math.max(0, currentState.arm_axes[i]));
      buffer[offset++] = 0x30 + intensity;  // Convert to ASCII '0'-'9'
    }

    return buffer;
  };

  const sendUDPMessage = (newState) => {
    if (!socket || !connected) {
      return;
    }
    
    const buffer = buildBinaryPacket(newState);

    try {
      socket.send(buffer, 0, buffer.length, ROVER_PORT, ROVER_IP, (err) => {
        if (err) {
          addLog(`Send error: ${err.message}`);
        } else {
          // Log packet details for debugging
          const hexData = buffer.toString('hex');
          addLog(`SENT: ${hexData} (${buffer.length} bytes)`);
        }
      });
    } catch (error) {
      addLog(`Failed to send: ${error.message}`);
    }
  };

  // --- CONTROL FUNCTIONS ---
  
  /**
   * ⚠️ FIXED: Now matches C code's tank drive calculation exactly
   * From udp_server.c: calculate_movement_values function
   */
  const sendVehicleVelocity = (x, y) => {
    // x: -1 (left) ... 1 (right)
    // y: -1 (back) ... 1 (forward)

    // Calculate left and right stick values (tank drive)
    let left_stick = y + x;
    let right_stick = y - x;

    // Clamp to [-1, 1]
    left_stick = Math.max(-1.0, Math.min(1.0, left_stick));
    right_stick = Math.max(-1.0, Math.min(1.0, right_stick));

    // Sensitivity (adjust as needed: 0.1=slow, 0.2=medium, 0.3=fast)
    const sensitivity = 0.3;
    
    // ⚠️ FIXED: Match C code formula exactly
    // temp_vel_lin = (left_y + right_y) * (9999.0 / (32768.0 * 2.0)) * sensitivity
    // temp_vel_rot = ((left_y - right_y) * (999.0 / (32768.0 * 2.0))) * sensitivity
    
    // Since our sticks are normalized to [-1, 1], we scale differently:
    let temp_vel_lin = (left_stick + right_stick) * (9999.0 / 2.0) * sensitivity;
    let temp_vel_rot = (left_stick - right_stick) * (999.0 / 2.0) * sensitivity;

    // Determine directions
    let lin_dir = (temp_vel_lin < 0) ? 1 : 0;  // 1=reverse, 0=forward
    let rot_dir = (temp_vel_rot > 0) ? 1 : 0;  // 1=right, 0=left
    
    // Convert to absolute values and clamp
    let vel_lin = Math.min(3999, Math.floor(Math.abs(temp_vel_lin)));
    let vel_rot = Math.min(399, Math.floor(Math.abs(temp_vel_rot)));

    // If joystick is centered, stop everything
    if (x === 0 && y === 0) {
      vel_lin = 0;
      vel_rot = 0;
      lin_dir = 1; // Default forward direction when stopped
    }

    const newState = {
      ...controlState,
      lin_dir: lin_dir,
      lin_vel: vel_lin,
      rot_dir: rot_dir,
      rot_vel: vel_rot,
    };
    setControlState(newState);
    sendUDPMessage(newState);
  };

  const sendArmVelocity = (joint, velocity) => {
    // velocity: -1, 0, 1
    // Map to intensity (0-9), where 5 is neutral
    const intensity = Math.floor((velocity * 4) + 5);
    const clampedIntensity = Math.min(9, Math.max(0, intensity));

    const newArmAxes = [...controlState.arm_axes];

    // Map joints to axes (adjust based on your robot's configuration)
    const jointMap = {
      'base': 0,
      'shoulder': 1,
      'elbow': 2,
      'wrist': 3,
      'gripper': 4,
      'wrist_rotate': 5,
    };

    if (jointMap[joint] !== undefined) {
      newArmAxes[jointMap[joint]] = clampedIntensity;
    }
    
    const newState = {
      ...controlState,
      arm_axes: newArmAxes,
    };
    setControlState(newState);
    sendUDPMessage(newState);
  };

  const stopAll = () => {
    const newState = {
      lin_dir: 1,
      lin_vel: 0,
      rot_dir: 0,
      rot_vel: 0,
      arm_axes: [5, 5, 5, 5, 5, 5],
    };
    setControlState(newState);
    sendUDPMessage(newState);
  };

  // --- RENDER (UI) ---
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Rover Control</Text>
        <Text style={styles.subtitle}>Target: {ROVER_IP}:{ROVER_PORT}</Text>
        
        <TouchableOpacity
          style={styles.wifiButton}
          onPress={() => setWifiModalVisible(true)}
        >
          <Text style={styles.wifiButtonText}>
            📡 {currentSSID || 'Not Connected'}
          </Text>
        </TouchableOpacity>

        <View style={[styles.statusBadge, connected && styles.statusConnected]}>
          <Text style={styles.statusText}>
            {connected ? 'UDP Ready' : 'UDP Not Ready'}
          </Text>
        </View>
      </View>

      {/* Wi-Fi Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={wifiModalVisible}
        onRequestClose={() => setWifiModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>WiFi Networks</Text>
            <Text style={styles.modalSubtitle}>
              Current: {currentSSID || 'None'}
            </Text>

            <TouchableOpacity
              style={styles.scanButton}
              onPress={scanWifiNetworks}
              disabled={isScanning}
            >
              <Text style={styles.scanButtonText}>
                {isScanning ? 'Scanning...' : '🔄 Scan Networks'}
              </Text>
            </TouchableOpacity>

            <ScrollView style={styles.networkList}>
              {availableNetworks.map((network, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.networkItem,
                    network.SSID.includes(ROVER_SSID_PREFIX) && styles.roverNetwork,
                  ]}
                  onPress={() => connectToWifi(network.SSID)}
                >
                  <View style={styles.networkInfo}>
                    <Text style={styles.networkSSID}>
                      {network.SSID.includes(ROVER_SSID_PREFIX) && '🤖 '}
                      {network.SSID}
                    </Text>
                    <Text style={styles.networkSignal}>
                      {getSignalStrength(network.level)} {network.level} dBm
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {availableNetworks.length === 0 && (
                <Text style={styles.noNetworks}>
                  No networks found. Press "Scan Networks"
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setWifiModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Vehicle Control */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vehicle Control</Text>
        <View style={styles.joystickContainer}>
          <View style={styles.joystickRow}>
            <TouchableOpacity
              style={styles.directionButton}
              onPressIn={() => sendVehicleVelocity(0, 1)}
              onPressOut={() => sendVehicleVelocity(0, 0)}
            >
              <Text style={styles.buttonText}>↑</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.joystickRow}>
            <TouchableOpacity
              style={styles.directionButton}
              onPressIn={() => sendVehicleVelocity(-1, 0)}
              onPressOut={() => sendVehicleVelocity(0, 0)}
            >
              <Text style={styles.buttonText}>←</Text>
            </TouchableOpacity>
            <View style={styles.spacer} />
            <TouchableOpacity
              style={styles.directionButton}
              onPressIn={() => sendVehicleVelocity(1, 0)}
              onPressOut={() => sendVehicleVelocity(0, 0)}
            >
              <Text style={styles.buttonText}>→</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.joystickRow}>
            <TouchableOpacity
              style={styles.directionButton}
              onPressIn={() => sendVehicleVelocity(0, -1)}
              onPressOut={() => sendVehicleVelocity(0, 0)}
            >
              <Text style={styles.buttonText}>↓</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.velocityText}>
          Lin: {controlState.lin_vel} (Dir: {controlState.lin_dir}) | Rot: {controlState.rot_vel} (Dir: {controlState.rot_dir})
        </Text>
      </View>

      {/* Robotic Arm Control */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Robotic Arm Control</Text>
        
        {[
          { name: 'base', axis: 0 },
          { name: 'shoulder', axis: 1 },
          { name: 'elbow', axis: 2 },
          { name: 'wrist', axis: 3 },
          { name: 'gripper', axis: 4 },
          { name: 'wrist_rotate', axis: 5 },
        ].map((joint) => (
          <View key={joint.name} style={styles.armControl}>
            <Text style={styles.jointLabel}>{joint.name.toUpperCase()}</Text>
            <View style={styles.armButtons}>
              <TouchableOpacity
                style={styles.armButton}
                onPressIn={() => sendArmVelocity(joint.name, -1)}
                onPressOut={() => sendArmVelocity(joint.name, 0)}
              >
                <Text style={styles.buttonText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.armValue}>
                {controlState.arm_axes[joint.axis]}
              </Text>
              <TouchableOpacity
                style={styles.armButton}
                onPressIn={() => sendArmVelocity(joint.name, 1)}
                onPressOut={() => sendArmVelocity(joint.name, 0)}
              >
                <Text style={styles.buttonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Emergency Stop */}
      <TouchableOpacity style={styles.stopButton} onPress={stopAll}>
        <Text style={styles.stopButtonText}>⚠️ EMERGENCY STOP</Text>
      </TouchableOpacity>

      {/* Status Log */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Log</Text>
        <View style={styles.logContainer}>
          {statusLog.map((log, index) => (
            <Text key={index} style={[styles.logText, log.includes('RECEIVED:') && styles.logReceived]}>
              {log}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// Styles remain the same
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 10,
  },
  wifiButton: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 10,
  },
  wifiButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 15,
    backgroundColor: '#ff4444',
  },
  statusConnected: {
    backgroundColor: '#44ff44',
  },
  statusText: {
    color: '#000',
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 5,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 15,
  },
  scanButton: {
    backgroundColor: '#0f3460',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  scanButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  networkList: {
    maxHeight: 400,
  },
  networkItem: {
    backgroundColor: '#1a1a2e',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  roverNetwork: {
    backgroundColor: '#2a4a3e',
    borderWidth: 2,
    borderColor: '#44ff44',
  },
  networkInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  networkSSID: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  networkSignal: {
    color: '#aaa',
    fontSize: 12,
  },
  noNetworks: {
    color: '#aaa',
    textAlign: 'center',
    padding: 20,
  },
  closeButton: {
    backgroundColor: '#666',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
  },
  closeButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  section: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 15,
  },
  joystickContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  joystickRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 5,
  },
  directionButton: {
    width: 80,
    height: 80,
    backgroundColor: '#0f3460',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 5,
  },
  spacer: {
    width: 80,
    height: 80,
    margin: 5,
  },
  buttonText: {
    fontSize: 30,
    color: '#fff',
    fontWeight: 'bold',
  },
  velocityText: {
    color: '#aaa',
    textAlign: 'center',
    marginTop: 10,
    fontSize: 14,
  },
  armControl: {
    marginBottom: 15,
  },
  jointLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  armButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  armButton: {
    width: 60,
    height: 60,
    backgroundColor: '#0f3460',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  armValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    minWidth: 80,
    textAlign: 'center',
  },
  stopButton: {
    backgroundColor: '#ff4444',
    padding: 20,
    borderRadius: 10,
    marginBottom: 20,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  logContainer: {
    backgroundColor: '#0a0a0a',
    borderRadius: 5,
    padding: 10,
    maxHeight: 200,
  },
  logText: {
    color: '#0f0',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  logReceived: {
    color: '#00ffff',
    fontWeight: 'bold',
  },
});

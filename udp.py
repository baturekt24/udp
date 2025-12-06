import socket
import struct

LISTEN_IP = "192.168.1.95" # Listen on all interfaces
LISTEN_PORT = 6102
PACKET_SIZE = 19

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((LISTEN_IP, LISTEN_PORT))

print(f"UDP Listener started on {LISTEN_IP}:{LISTEN_PORT}")

while True:
    try:
        data, addr = sock.recvfrom(1024)
        
        # Check if packet is the expected size
        if len(data) >= 19:
            # --- PARSE BINARY HEADER (Bytes 0-4) ---
            # '>HH' format means:
            # > : Big Endian (matches writeUInt16BE in React Native)
            # H : Unsigned Short (2 bytes) - Timestamp
            # H : Unsigned Short (2 bytes) - OpMode
            timestamp, op_mode = struct.unpack('>HH', data[0:4])
            
            # --- PARSE ASCII BODY (Bytes 4-19) ---
            # We decode only from byte 4 onwards
            try:
                payload = data[4:].decode('utf-8')
            except UnicodeDecodeError:
                payload = "RAW: " + data[4:].hex()

            # --- PRINT FORMATTED DATA ---
            print("-" * 40)
            print(f"Source:  {addr[0]}:{addr[1]}")
            print(f"Time:    {timestamp}")
            print(f"OpMode:  0x{op_mode:02X} (Binary: {bin(op_mode)})")
            print(f"Payload: {payload}")
            
            # Parse specific payload parts for easier debugging
            if len(payload) >= 15:
                rot_dir = payload[0]
                rot_vel = payload[1:4]
                lin_dir = payload[4]
                lin_vel = payload[5:9]
                arm_data = payload[9:]
                print(f" -> Drive: Rot[{rot_dir}:{rot_vel}] Lin[{lin_dir}:{lin_vel}]")
                print(f" -> Arm:   {arm_data}")
        else:
            print(f"Received partial packet: {data.hex()}")

    except Exception as e:
        print(f"Error: {e}")
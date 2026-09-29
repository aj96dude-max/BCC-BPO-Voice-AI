import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFonts, JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

export default function App() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });

  const [transcripts, setTranscripts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef(null);
  const scrollViewRef = useRef();

  useEffect(() => {
    // Connect to the backend WebSocket
    // Replace with your local machine's IP address if testing on physical device
    ws.current = new WebSocket('ws://localhost:8080/mobile');

    ws.current.onopen = () => {
      console.log('Connected to Command Center');
      setIsConnected(true);
    };

    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'transcript') {
          setTranscripts((prev) => [...prev, data]);
        }
      } catch (err) {
        console.error(err);
      }
    };

    ws.current.onclose = () => {
      console.log('Disconnected from Command Center');
      setIsConnected(false);
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const handleOverride = () => {
    if (ws.current && isConnected) {
      ws.current.send(JSON.stringify({ action: 'override' }));
      alert('Manual Override Initiated: Transferring to SIP');
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>BPO COMMAND CENTER</Text>
          <Text style={styles.headerSubtitle}>
            Status: {isConnected ? '● LIVE' : '○ OFFLINE'}
          </Text>
        </View>
        <TouchableOpacity style={styles.overrideBtn} onPress={handleOverride}>
          <Text style={styles.overrideBtnText}>MANUAL OVERRIDE</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.transcriptArea}
        ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current.scrollToEnd({ animated: true })}
      >
        {transcripts.map((t, idx) => (
          <View key={idx} style={[
            styles.messageContainer, 
            t.role === 'agent' ? styles.agentMessage : styles.userMessage
          ]}>
            <Text style={styles.roleText}>{t.role === 'agent' ? 'AI AGENT' : 'CALLER'}</Text>
            <Text style={styles.transcriptText}>{t.text}</Text>
          </View>
        ))}
        {transcripts.length === 0 && (
          <Text style={styles.emptyText}>Waiting for active calls...</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff', // Solid white background
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth, // Hair-thin gray borders
    borderBottomColor: '#d1d1d1',
  },
  headerTitle: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 18,
    color: '#000',
  },
  headerSubtitle: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  overrideBtn: {
    backgroundColor: '#000',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  overrideBtnText: {
    color: '#fff',
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 12,
  },
  transcriptArea: {
    flex: 1,
    padding: 20,
  },
  messageContainer: {
    marginBottom: 20,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth, // Hair-thin borders
    borderColor: '#e0e0e0',
  },
  agentMessage: {
    backgroundColor: '#fafafa',
  },
  userMessage: {
    backgroundColor: '#ffffff',
  },
  roleText: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 10,
    color: '#888',
    marginBottom: 8,
  },
  transcriptText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  emptyText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 40,
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

const STORAGE_KEY = 'bcc.command.connection';
const DEFAULT_WS = process.env.EXPO_PUBLIC_COMMAND_CENTER_URL || 'ws://localhost:8080/mobile';

function withToken(url, token) {
  if (!token) return url;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}token=${encodeURIComponent(token)}`;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const [token, setToken] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [call, setCall] = useState(null);
  const [order, setOrder] = useState(null);
  const ws = useRef(null);
  const retry = useRef(0);
  const scrollViewRef = useRef();
  const unmounted = useRef(false);
  const wsUrlRef = useRef(wsUrl);
  const tokenRef = useRef(token);
  wsUrlRef.current = wsUrl;
  tokenRef.current = token;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved.wsUrl) setWsUrl(saved.wsUrl);
        if (saved.token) setToken(saved.token);
      } catch {
        // ignore corrupt local settings
      }
    });
    return () => {
      unmounted.current = true;
      if (ws.current) ws.current.close();
    };
  }, []);

  const persist = useCallback(async (nextUrl, nextToken) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ wsUrl: nextUrl, token: nextToken }));
  }, []);

  const connect = useCallback(() => {
    if (ws.current) {
      ws.current.onclose = null;
      ws.current.close();
    }
    const url = wsUrlRef.current;
    const secret = tokenRef.current;
    const socket = new WebSocket(withToken(url, secret));
    ws.current = socket;

    socket.onopen = () => {
      retry.current = 0;
      setIsConnected(true);
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcript') {
          setTranscripts((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === data.role && last.isFinal === false && data.role === 'user') {
              next[next.length - 1] = data;
              return next;
            }
            next.push(data);
            return next.slice(-80);
          });
        } else if (data.type === 'call.started' || data.type === 'call.update') {
          setCall(data.call);
        } else if (data.type === 'order') {
          setOrder(data.order);
        }
      } catch (error) {
        console.error(error);
      }
    };
    socket.onclose = () => {
      setIsConnected(false);
      if (unmounted.current) return;
      const delay = Math.min(8000, 500 * 2 ** retry.current);
      retry.current += 1;
      setTimeout(() => {
        if (!unmounted.current) connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  const handleConnect = async () => {
    await persist(wsUrl, token);
    retry.current = 0;
    connect();
  };

  const handleOverride = () => {
    if (!ws.current || !isConnected) return;
    ws.current.send(JSON.stringify({ action: 'override', callId: call?.id }));
    Alert.alert('Override sent', 'Transferring the live call to a human agent.');
  };

  const fields = call?.fields || [];
  const filled = fields.filter((field) => field.value).length;
  const statusLabel = useMemo(() => {
    if (!isConnected) return 'OFFLINE';
    if (!call || call.status === 'ended') return 'LIVE · WAITING';
    return `LIVE · ${(call.status || 'live').toUpperCase()}`;
  }, [isConnected, call]);

  if (!fontsLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.headerTitle}>BCC COMMAND CENTER</Text>
            <Text style={styles.headerSubtitle}>
              {isConnected ? '●' : '○'} {statusLabel}
              {call?.campaignName ? ` · ${call.campaignName}` : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.overrideBtn} onPress={handleOverride} disabled={!isConnected}>
            <Text style={styles.overrideBtnText}>OVERRIDE</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.settings}>
          <TextInput
            style={styles.input}
            value={wsUrl}
            onChangeText={setWsUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="ws://host:8080/mobile"
            placeholderTextColor="#999"
          />
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="command token (optional)"
            placeholderTextColor="#999"
            secureTextEntry
          />
          <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
            <Text style={styles.connectBtnText}>CONNECT</Text>
          </TouchableOpacity>
        </View>

        {fields.length > 0 && (
          <View style={styles.ticket}>
            <Text style={styles.ticketTitle}>INTAKE {filled}/{fields.length}</Text>
            {fields.map((field) => (
              <Text key={field.key} style={styles.ticketLine}>
                {field.required ? '* ' : '  '}
                {field.label}: {field.value || '—'}
              </Text>
            ))}
            {order ? <Text style={styles.ticketDone}>Ticket {order.id.slice(0, 8)} posted</Text> : null}
          </View>
        )}

        <ScrollView
          style={styles.transcriptArea}
          ref={scrollViewRef}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {transcripts.map((item, idx) => (
            <View
              key={`${item.callId || 'x'}-${idx}`}
              style={[styles.messageContainer, item.role === 'agent' ? styles.agentMessage : styles.userMessage]}
            >
              <Text style={styles.roleText}>{item.role === 'agent' ? 'AI AGENT' : 'CALLER'}</Text>
              <Text style={styles.transcriptText}>{item.text}</Text>
            </View>
          ))}
          {transcripts.length === 0 && (
            <Text style={styles.emptyText}>Waiting for inbound calls. Map a Twilio number to /incoming-call.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d1',
    gap: 12,
  },
  headerTitle: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 16,
    color: '#000',
  },
  headerSubtitle: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  overrideBtn: {
    backgroundColor: '#000',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  overrideBtnText: {
    color: '#fff',
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 11,
  },
  settings: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    color: '#111',
  },
  connectBtn: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  connectBtnText: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 11,
    color: '#000',
  },
  ticket: {
    margin: 16,
    marginBottom: 0,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  ticketTitle: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 11,
    color: '#111',
    marginBottom: 8,
  },
  ticketLine: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#333',
    marginBottom: 4,
  },
  ticketDone: {
    marginTop: 8,
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 11,
    color: '#111',
  },
  transcriptArea: { flex: 1, padding: 16 },
  messageContainer: {
    marginBottom: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
  },
  agentMessage: { backgroundColor: '#fafafa' },
  userMessage: { backgroundColor: '#ffffff' },
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

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  RefreshControl,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import AppPressable from '../components/AppPressable';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera, Image as ImageIcon, CircleCheck, AlertCircle,
  Scan, BookOpen, Clock, MapPin, ChevronLeft, Zap, ZapOff, Video
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

let FaceDetector = null;
let isFaceDetectorAvailable = false;
try {
  FaceDetector = require('expo-face-detector');
  isFaceDetectorAvailable = !!FaceDetector;
} catch (e) {
  console.log('Native ExpoFaceDetector module not available:', e);
}
import api from '../utils/api';
import { parseApiError, toImagePayload } from '../utils/validation';
import { colors, spacing, radius, shadow } from '../theme';

export default function AttendanceScreen({ route, navigation }) {
  const session_id = route?.params?.session_id;
  
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [camStatus, setCamStatus] = useState('idle'); // idle, processing, success, error
  const [camMessage, setCamMessage] = useState('Vui lòng đưa khuôn mặt vào khung');
  const [isAutoMode, setIsAutoMode] = useState(isFaceDetectorAvailable);
  const timeoutRef = useRef(null);
  
  const [lastResult, setLastResult] = useState(null);
  const [todayLogs, setTodayLogs] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedSession, setSelectedSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [threshold, setThreshold] = useState(0.55);
  const [cameraMode, setCameraMode] = useState('picture');
  const [attendanceMethod, setAttendanceMethod] = useState('photo');

  // Scanning states & refs
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);

  const scanIntervalRef = useRef(null);
  const scanTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isScanningRef = useRef(false);

  const confirmMapRef = useRef({});
  const markedStudentsRef = useRef(new Set());
  const markingStudentsRef = useRef(new Set());
  const lastNotifyRef = useRef({});

  // Scanning parameters
  const SCAN_INTERVAL_MS = 800;
  const MAX_SCAN_DURATION_SECONDS = 30;
  const MIN_CONFIRM_FRAMES = 2;
  const CONFIRM_WINDOW_MS = 5000;
  const HIGH_CONFIDENCE_BONUS = 0.10;
  const IMAGE_QUALITY = 0.5;

  const SUCCESS_STATUSES = ['present', 'late', 'already_marked', 'success', 'marked'];

  const isSuccessStatus = (status) => {
    return SUCCESS_STATUSES.includes(status);
  };

  const upsertScanResult = (newResult) => {
    // Ensure newResult has a valid unique id if it doesn't already have one
    if (!newResult.id) {
      newResult.id = newResult.student_id 
        ? `student-${newResult.student_id}-${Date.now()}-${Math.random()}` 
        : `unknown-${Date.now()}-${Math.random()}`;
    }

    setScanResults((prev) => {
      // If it is unknown
      if (!newResult.student_id) {
        const unknownCount = prev.filter(item => !item.student_id).length;
        if (unknownCount >= 3) {
          return prev;
        }
        return [newResult, ...prev].slice(0, 10);
      }

      // If it's a student with student_id
      const index = prev.findIndex(
        (item) => item.student_id === newResult.student_id
      );

      if (index >= 0) {
        const updated = [...prev];
        const oldItem = updated[index];

        const oldStatus = oldItem.status;

        if (isSuccessStatus(oldStatus)) {
          updated[index] = {
            ...oldItem,
            confidence: Math.max(oldItem.confidence || 0, newResult.confidence || 0),
            timestamp: Date.now(),
          };
        } else {
          updated[index] = {
            ...oldItem,
            ...newResult,
            id: oldItem.id, // Explicitly preserve the old item's key!
            confidence: Math.max(oldItem.confidence || 0, newResult.confidence || 0),
            timestamp: Date.now(),
          };
        }
        return updated;
      }

      // If it doesn't exist, we only add if it's a complete record (has student_name)
      if (newResult.student_name) {
        return [newResult, ...prev].slice(0, 10);
      }
      return prev;
    });
  };

  const notifyOnce = (studentId, studentName, status) => {
    const now = Date.now();
    const last = lastNotifyRef.current[studentId] || 0;
    if (now - last < 15000) {
      return;
    }
    lastNotifyRef.current[studentId] = now;
    console.log(`Notification: ${studentName} điểm danh thành công (${status})`);
  };

  const markStudentOnce = async (studentId, studentName, bestFrameBase64, bestResult) => {
    if (!studentId) return;

    if (markedStudentsRef.current.has(studentId) || markingStudentsRef.current.has(studentId)) {
      return;
    }

    markingStudentsRef.current.add(studentId);

    upsertScanResult({
      ...bestResult,
      student_id: studentId,
      student_name: studentName,
      status: 'marking',
      message: 'Đang ghi nhận...',
      timestamp: Date.now(),
    });

    try {
      const markPayload = {
        image: toImagePayload(bestFrameBase64),
        session_id: selectedSession.id,
        threshold: threshold,
      };

      const response = await api.markAttendance(markPayload);

      if (response && response.success) {
        markedStudentsRef.current.add(studentId);
        
        // Find the result for this student in backend response
        const studentResult = response.results?.find(r => r.student_id === studentId);
        const status = studentResult?.status || 'present';

        upsertScanResult({
          ...bestResult,
          student_id: studentId,
          student_name: studentName,
          status: status,
          message: status === 'late' ? 'Đi muộn' : 'Có mặt',
          confidence: studentResult?.confidence || bestResult.confidence,
          timestamp: Date.now(),
        });

        notifyOnce(studentId, studentName, status);
        loadTodayLogs();
      } else {
        markingStudentsRef.current.delete(studentId);
      }
    } catch (error) {
      const errMsg = error.message || parseApiError(error);
      const isAlready = errMsg.toLowerCase().includes('đã điểm danh') || 
                        errMsg.toLowerCase().includes('already') ||
                        error.status === 409;

      if (isAlready) {
        markedStudentsRef.current.add(studentId);
        upsertScanResult({
          ...bestResult,
          student_id: studentId,
          student_name: studentName,
          status: 'already_marked',
          message: 'Đã điểm danh',
          timestamp: Date.now(),
        });
      } else {
        markingStudentsRef.current.delete(studentId);
        upsertScanResult({
          ...bestResult,
          student_id: studentId,
          student_name: studentName,
          status: 'error',
          message: errMsg,
          timestamp: Date.now(),
        });
      }
    }
  };

  const loadData = async () => {
    if (!session_id) {
      setLoadingSession(false);
      return;
    }
    try {
      setLoadingSession(true);
      const sessionRes = await api.getSessionDetail(session_id);
      setSelectedSession(sessionRes);
    } catch (e) {
      console.log('Error loading session', e);
    } finally {
      setLoadingSession(false);
    }
  };

  const loadTodayLogs = async () => {
    if (!session_id) return;
    try {
      const data = await api.getTodayAttendance(session_id);
      setTodayLogs(data.records?.slice(0, 8) || []);
    } catch { /* ignore */ }
  };

  const loadStoredThreshold = async () => {
    try {
      const val = await AsyncStorage.getItem('FACE_MATCH_THRESHOLD');
      if (val !== null) {
        setThreshold(parseFloat(val));
      } else {
        setThreshold(0.55);
      }
    } catch {
      setThreshold(0.55);
    }
  };

  const handleSaveThreshold = async (val) => {
    try {
      const formattedVal = Number(val.toFixed(2));
      await AsyncStorage.setItem('FACE_MATCH_THRESHOLD', String(formattedVal));
      setThreshold(formattedVal);
    } catch (e) {
      console.log('Error saving threshold:', e);
    }
  };

  const stopScanning = () => {
    isScanningRef.current = false;
    setIsScanning(false);
    isProcessingRef.current = false;
    
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    
    setCamStatus('idle');
    setCamMessage('Vui lòng đưa khuôn mặt vào khung');
  };

  const startScanning = () => {
    if (!selectedSession) {
      Alert.alert('Chưa chọn ca học', 'Vui lòng chọn ca học trước khi bắt đầu quét.');
      return;
    }
    
    // Reset refs and state
    confirmMapRef.current = {};
    markedStudentsRef.current = new Set();
    markingStudentsRef.current = new Set();
    lastNotifyRef.current = {};
    isProcessingRef.current = false;
    setScanResults([]);
    
    isScanningRef.current = true;
    setIsScanning(true);
    setCamStatus('processing');
    setCamMessage('Đang quét khuôn mặt...');
    
    // Auto-stop after 30s
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      stopScanning();
      Alert.alert('Thông báo', 'Hết thời gian quét tự động (30 giây).');
    }, MAX_SCAN_DURATION_SECONDS * 1000);

    // Frame capture interval (800ms)
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    scanIntervalRef.current = setInterval(async () => {
      await captureFrameAndProcess();
    }, SCAN_INTERVAL_MS);
  };

  const captureFrameAndProcess = async () => {
    if (!isScanningRef.current) return;
    if (isProcessingRef.current) return;
    
    if (!cameraRef.current || !cameraReady) {
      console.log('Camera not ready for scanning frame');
      return;
    }

    isProcessingRef.current = true;
    try {
      let photo;
      try {
        photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: IMAGE_QUALITY,
          skipProcessing: true,
        });
      } catch (err) {
        // Fallback without skipProcessing
        photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: IMAGE_QUALITY,
        });
      }

      if (!photo?.base64) {
        isProcessingRef.current = false;
        return;
      }

      const payload = {
        image: toImagePayload(photo.base64),
        session_id: selectedSession.id,
        threshold: threshold
      };

      const response = await api.scanAttendanceFrame(payload);
      
      if (response && response.success) {
        await handleScanResults(response.results, photo.base64);
      }
    } catch (error) {
      console.log('Error scanning frame:', error);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const handleScanResults = async (results, base64Frame) => {
    if (!results || results.length === 0) {
      return;
    }

    for (const result of results) {
      const studentId = result.student_id;
      const studentName = result.student_name;
      const confidence = result.confidence || result.similarity || 0;
      const recognitionStatus = result.recognition_status || result.status;

      // 1. Nếu result không có student_id (Unknown)
      if (!studentId) {
        upsertScanResult({
          id: `unknown-${Date.now()}-${Math.random()}`,
          student_id: null,
          student_name: 'Unknown',
          confidence: confidence,
          status: 'unknown',
          message: 'Không xác định',
          timestamp: Date.now()
        });
        continue;
      }

      // 2. Nếu student_id đã nằm trong markedStudentsRef
      if (markedStudentsRef.current.has(studentId)) {
        upsertScanResult({
          student_id: studentId,
          confidence: confidence,
        });
        continue;
      }

      // 3. Nếu student_id đang nằm trong markingStudentsRef
      if (markingStudentsRef.current.has(studentId)) {
        upsertScanResult({
          student_id: studentId,
          confidence: confidence,
        });
        continue;
      }

      // 4. Nếu backend trả already_marked
      if (recognitionStatus === 'already_marked') {
        markedStudentsRef.current.add(studentId);
        upsertScanResult({
          id: `already-${studentId}-${Date.now()}`,
          student_id: studentId,
          student_name: studentName,
          confidence: confidence,
          status: 'already_marked',
          message: 'Đã điểm danh',
          timestamp: Date.now()
        });
        continue;
      }

      // 5. Nếu backend trả recognized
      if (recognitionStatus === 'recognized') {
        const highConfidenceThreshold = Math.min(0.95, threshold + HIGH_CONFIDENCE_BONUS);
        let shouldCommit = false;
        let frameToUse = base64Frame;
        let commitConfidence = confidence;

        if (confidence >= highConfidenceThreshold) {
          shouldCommit = true;
          console.log(`High confidence match: ${studentName} (${confidence} >= ${highConfidenceThreshold})`);
        } else if (confidence >= threshold) {
          const now = Date.now();
          const record = confirmMapRef.current[studentId];

          if (!record || now - record.lastSeenAt > CONFIRM_WINDOW_MS) {
            confirmMapRef.current[studentId] = {
              count: 1,
              lastSeenAt: now,
              bestConfidence: confidence,
              bestFrameBase64: base64Frame,
              bestResult: result
            };
            
            upsertScanResult({
              id: `confirming-${studentId}-${Date.now()}`,
              student_id: studentId,
              student_name: studentName,
              confidence: confidence,
              status: 'confirming',
              message: `Đang xác nhận 1/${MIN_CONFIRM_FRAMES}`,
              timestamp: now
            });
          } else {
            const nextCount = record.count + 1;
            const isBetter = confidence > record.bestConfidence;
            
            record.count = nextCount;
            record.lastSeenAt = now;
            if (isBetter) {
              record.bestConfidence = confidence;
              record.bestFrameBase64 = base64Frame;
              record.bestResult = result;
            }

            if (nextCount >= MIN_CONFIRM_FRAMES) {
              shouldCommit = true;
              frameToUse = record.bestFrameBase64;
              commitConfidence = record.bestConfidence;
            } else {
              upsertScanResult({
                id: `confirming-${studentId}-${Date.now()}`,
                student_id: studentId,
                student_name: studentName,
                confidence: record.bestConfidence,
                status: 'confirming',
                message: `Đang xác nhận ${nextCount}/${MIN_CONFIRM_FRAMES}`,
                timestamp: now
              });
            }
          }
        }

        if (shouldCommit) {
          markStudentOnce(studentId, studentName, frameToUse, {
            ...result,
            confidence: commitConfidence
          });
        }
      }
    }
  };

  const handleMethodChange = (method) => {
    setAttendanceMethod(method);
    if (method !== 'scan') {
      stopScanning();
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadStoredThreshold();
      if (session_id) {
        loadData();
        loadTodayLogs();
      }
      setLastResult(null);
      setCamStatus('idle');
      setCamMessage('Vui lòng đưa khuôn mặt vào khung');
      
      return () => {
        stopScanning();
      };
    }, [session_id])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState !== 'active') {
        stopScanning();
      }
    });

    return () => {
      subscription.remove();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTodayLogs();
    setRefreshing(false);
  }, []);

  const markAttendance = async (base64) => {
    if (!selectedSession) return;
    if (camStatus === 'processing' || camStatus === 'success') return;

    const image = toImagePayload(base64);
    if (!image) {
      setCamStatus('error');
      setCamMessage('Không đọc được ảnh');
      resetCamStatusDelay();
      return;
    }

    setCamStatus('processing');
    setCamMessage('Đang nhận diện...');
    try {
      const response = await api.markAttendance({ 
        image, 
        session_id: selectedSession.id, 
        threshold: threshold 
      });
      
      if (!response.success || response.total_faces_detected === 0) {
        setLastResult({ type: 'warning', message: 'Không phát hiện khuôn mặt trong ảnh.' });
        setCamStatus('error');
        setCamMessage('Không có khuôn mặt');
        resetCamStatusDelay();
        return;
      }

      setLastResult({ type: 'success', summary: response, results: response.results });
      await loadTodayLogs();
      
      if (response.recognized_count > 0) {
        setCamStatus('success');
        setCamMessage(`Đã điểm danh ${response.recognized_count} sinh viên`);
      } else {
        setCamStatus('error');
        setCamMessage('Không nhận diện được sinh viên hợp lệ');
      }
      resetCamStatusDelay();
    } catch (err) {
      const msg = err.message || parseApiError(err);
      const already = msg.includes('đã điểm danh');
      setLastResult({ type: already ? 'warning' : 'error', message: msg });
      
      setCamStatus('error');
      setCamMessage(msg);
      resetCamStatusDelay();
    }
  };

  const resetCamStatusDelay = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (isScanningRef.current) {
      setCamStatus('processing');
      setCamMessage('Đang quét khuôn mặt...');
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setCamStatus('idle');
      setCamMessage('Vui lòng đưa khuôn mặt vào khung');
    }, 2000);
  };

  const captureFromCamera = async (isAuto = false) => {
    if (camStatus === 'processing' || camStatus === 'success') return;
    if (!cameraRef.current || !cameraReady) {
      if (!isAuto) {
        Alert.alert('Camera', 'Camera chưa sẵn sàng, vui lòng đợi giây lát.');
      }
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (photo?.base64) {
        await markAttendance(photo.base64);
      }
    } catch (err) {
      if (!isAuto) {
        Alert.alert('Lỗi', 'Không chụp được ảnh từ camera.');
      } else {
        console.log('Lỗi chụp ảnh tự động:', err);
      }
    }
  };

  const recordVideoAndMark = async () => {
    if (camStatus === 'processing' || camStatus === 'success') return;
    if (!selectedSession) {
      Alert.alert('Lỗi ca học', 'Vui lòng chọn ca học hợp lệ trước khi điểm danh.');
      return;
    }
    if (!cameraRef.current || !cameraReady) {
      Alert.alert('Camera', 'Camera chưa sẵn sàng, vui lòng đợi giây lát.');
      return;
    }

    try {
      setCamStatus('processing');
      setCamMessage('Chuẩn bị camera ghi hình...');
      setCameraMode('video');
      
      // Wait for camera view to adjust to video mode
      await new Promise((resolve) => setTimeout(resolve, 600));

      setCamMessage('Bắt đầu quay video (2s)...');
      
      // Start recording
      const videoPromise = cameraRef.current.recordAsync({
        maxDuration: 2,
        quality: '480p',
        mute: true,
      });

      // Countdown display
      let count = 2;
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setCamMessage(`Đang ghi hình (${count}s)...`);
        } else {
          clearInterval(interval);
        }
      }, 1000);

      const video = await videoPromise;
      clearInterval(interval);
      
      // Switch back to picture mode so normal operations are restored
      setCameraMode('picture');

      if (!video?.uri) {
        throw new Error('Không lấy được tệp video từ thiết bị.');
      }

      setCamMessage('Đang tải video lên server...');
      
      const formData = new FormData();
      const localUri = video.uri;
      const filename = localUri.split('/').pop() || 'attendance.mp4';
      
      formData.append('video', {
        uri: localUri,
        name: filename,
        type: 'video/mp4',
      });
      formData.append('session_id', String(selectedSession.id));
      formData.append('threshold', String(threshold));

      setCamMessage('Đang xử lý nhận diện video...');
      const response = await api.markAttendanceVideo(formData);
      
      if (!response.success || response.total_faces_detected === 0) {
        setLastResult({ type: 'warning', message: 'Không phát hiện khuôn mặt trong video.' });
        setCamStatus('error');
        setCamMessage('Không có khuôn mặt');
        resetCamStatusDelay();
        return;
      }

      setLastResult({ type: 'success', summary: response, results: response.results });
      await loadTodayLogs();
      
      if (response.recognized_count > 0) {
        setCamStatus('success');
        setCamMessage(`Đã điểm danh ${response.recognized_count} sinh viên`);
      } else {
        setCamStatus('error');
        setCamMessage('Không nhận diện được sinh viên hợp lệ');
      }
      resetCamStatusDelay();

    } catch (err) {
      setCameraMode('picture');
      const msg = err.message || parseApiError(err);
      setLastResult({ type: 'error', message: msg });
      
      setCamStatus('error');
      setCamMessage(msg);
      resetCamStatusDelay();
    }
  };

  const handleFacesDetected = useCallback(({ faces }) => {
    if (!isFaceDetectorAvailable || !isAutoMode) return;
    if (camStatus !== 'idle') return;
    if (!cameraReady || !selectedSession) return;
    
    if (faces && faces.length > 0) {
      captureFromCamera(true);
    }
  }, [isAutoMode, camStatus, cameraReady, selectedSession]);

  const pickFromGallery = async () => {
    if (camStatus === 'processing' || camStatus === 'success') return;
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Quyền truy cập', 'Cần quyền thư viện ảnh để chọn ảnh điểm danh.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.base64) {
      await markAttendance(result.assets[0].base64);
    }
  };

  const formatTime = (ts) =>
    ts ? new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '-';

  const formatCheckinTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  if (!session_id) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={{ color: colors.danger, marginBottom: spacing.md }}>Thiếu thông tin ca học (session_id).</Text>
        <AppPressable style={styles.btnSecondary} onPress={() => navigation.goBack()}>
          <Text style={styles.btnSecondaryText}>Quay lại</Text>
        </AppPressable>
      </SafeAreaView>
    );
  }

  if (loadingSession) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const handleRequestPermissions = async () => {
    await requestPermission();
    await requestMicPermission();
  };

  if (!permission?.granted || !micPermission?.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <AppPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ChevronLeft color={colors.text} size={24} />
          </AppPressable>
          <Text style={styles.headerTitle}>Điểm danh</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.permissionWrap}>
          <View style={styles.permissionBox}>
            <LinearGradient
              colors={[colors.primary, colors.primaryDark]}
              style={styles.permissionIconRing}
            >
              <Camera color="#fff" size={36} strokeWidth={1.5} />
            </LinearGradient>
            <Text style={styles.permissionTitle}>Cần quyền truy cập</Text>
            <Text style={styles.permissionText}>
              Ứng dụng cần truy cập camera và micro để nhận diện khuôn mặt và quay video điểm danh.
            </Text>
            <AppPressable style={styles.grantBtn} onPress={handleRequestPermissions}>
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.grantBtnGradient}
              >
                <Text style={styles.grantBtnText}>Cấp quyền truy cập</Text>
              </LinearGradient>
            </AppPressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const getResultBanner = () => {
    if (!lastResult) return null;
    if (lastResult.type === 'success') {
      const results = lastResult.results || [];
      const summary = lastResult.summary || {};
      
      return (
        <View style={styles.groupResultContainer}>
          <View style={styles.groupResultHeader}>
            <Text style={styles.groupResultTitle}>
              Kết quả nhận diện ({summary.total_faces_detected} khuôn mặt)
            </Text>
            <View style={{flexDirection: 'row', gap: 5}}>
              {summary.recognized_count > 0 && <Text style={styles.groupResultStatOk}>{summary.recognized_count} thành công</Text>}
              {summary.unknown_count > 0 && <Text style={styles.groupResultStatErr}>{summary.unknown_count} lạ</Text>}
            </View>
          </View>
          
          {results.map((r, idx) => {
            const isLate = r.status === 'late';
            const isUnknown = r.status === 'unknown';
            const isNotInClass = r.status === 'not_in_class';
            const isAlreadyMarked = r.status === 'already_marked';
            const isError = isUnknown || isNotInClass;
            
            let bgColor = colors.successBg;
            let borderColor = 'rgba(16,185,129,0.25)';
            let iconColor = colors.success;
            let badgeText = 'Đúng giờ';
            
            if (isLate) {
              bgColor = colors.warningBg;
              borderColor = 'rgba(245,158,11,0.25)';
              iconColor = colors.warning;
              badgeText = 'Đi muộn';
            } else if (isAlreadyMarked) {
              bgColor = colors.surface;
              borderColor = colors.border;
              iconColor = colors.textSecondary;
              badgeText = 'Đã điểm danh';
            } else if (isError) {
              bgColor = '#FEF2F2';
              borderColor = '#FCA5A5';
              iconColor = colors.danger;
              badgeText = isUnknown ? 'Không xác định' : 'Ngoài lớp';
            }

            return (
              <View key={idx} style={[styles.resultCard, { backgroundColor: bgColor, borderColor }]}>
                <View style={styles.resultLeft}>
                  <View style={[styles.resultAvatar, { backgroundColor: 'rgba(255,255,255,0.6)' }]}>
                    <Text style={[styles.resultAvatarText, { color: iconColor }]}>
                      {isError ? '?' : (r.student_name?.[0]?.toUpperCase() || '✓')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.student_name}</Text>
                    {isAlreadyMarked && r.checkin_time ? (
                      <Text style={styles.resultTime}>Đã ghi nhận lúc: {formatCheckinTime(r.checkin_time)}</Text>
                    ) : (
                      r.confidence && !isUnknown ? <Text style={styles.resultTime}>Độ chính xác: {(r.confidence * 100).toFixed(1)}%</Text> : null
                    )}
                  </View>
                </View>
                <View style={[styles.resultBadge, { shadowColor: iconColor }]}>
                  {isLate && <Clock color={iconColor} size={12} />}
                  {!isLate && !isError && !isAlreadyMarked && <CircleCheck color={iconColor} size={12} />}
                  {isError && <AlertCircle color={iconColor} size={12} />}
                  <Text style={[styles.resultBadgeText, { color: iconColor }]}>{badgeText}</Text>
                </View>
              </View>
            );
          })}
        </View>
      );
    }
    if (lastResult.type === 'warning' || lastResult.type === 'error') {
      return (
        <View style={[styles.resultCard, styles.resultCardWarn]}>
          <AlertCircle color={colors.warning} size={22} style={{ marginRight: spacing.sm }} />
          <Text style={[styles.resultMeta, { flex: 1, color: colors.text }]}>{lastResult.message}</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AppPressable style={styles.backBtn} onPress={() => navigation.goBack()} scaleEnabled={false}>
          <ChevronLeft color={colors.text} size={24} />
        </AppPressable>
        <Text style={styles.headerTitle}>Điểm danh AI</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        {selectedSession && (
          <LinearGradient
            colors={['rgba(79,110,247,0.10)', 'rgba(79,110,247,0.04)']}
            style={styles.sessionInfoCard}
          >
            <View style={styles.sessionInfoBadge}>
              <Text style={styles.sessionInfoBadgeText}>Đang điểm danh cho ca học:</Text>
            </View>
            <Text style={styles.sessionInfoName}>{selectedSession.subject?.subject_name}</Text>
            <View style={styles.sessionInfoRow}>
              <BookOpen color={colors.primary} size={13} />
              <Text style={styles.sessionInfoValue}>{selectedSession.course_class?.class_code} - {selectedSession.section_code}</Text>
            </View>
            <View style={styles.sessionInfoRow}>
              <Clock color={colors.primary} size={13} />
              <Text style={styles.sessionInfoValue}>
                {formatTime(selectedSession.start_time)} — {formatTime(selectedSession.end_time)}
              </Text>
            </View>
            <View style={styles.sessionInfoRow}>
              <MapPin color={colors.primary} size={13} />
              <Text style={styles.sessionInfoValue}>{selectedSession.room}</Text>
            </View>
          </LinearGradient>
        )}

        {/* Camera */}
        <View style={styles.cameraCard}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
            mode={cameraMode}
            onCameraReady={() => setCameraReady(true)}
            onFacesDetected={isFaceDetectorAvailable ? handleFacesDetected : undefined}
            faceDetectorSettings={isFaceDetectorAvailable ? {
              mode: FaceDetector.FaceDetectorMode.fast,
              detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
              runClassifications: FaceDetector.FaceDetectorClassifications.none,
              minDetectionInterval: 500,
              tracking: true,
            } : undefined}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.45)']}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 70 }}
          />
          <View style={styles.guideOverlay}>
            <View style={styles.guideFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            
            {/* Status Overlay Duy Nhất */}
            <View style={[
              styles.statusOverlay,
              camStatus === 'success' && styles.statusOverlaySuccess,
              camStatus === 'error' && styles.statusOverlayError,
              (camStatus === 'idle' || camStatus === 'processing') && styles.statusOverlayInfo
            ]}>
              {camStatus === 'processing' && <ActivityIndicator size="small" color="#fff" />}
              {camStatus === 'success' && <CircleCheck color="#fff" size={16} />}
              {camStatus === 'error' && <AlertCircle color="#fff" size={16} />}
              {camStatus === 'idle' && <Scan color="#fff" size={16} />}
              
              <Text style={styles.statusOverlayText} numberOfLines={1}>
                {camMessage}
              </Text>
            </View>
          </View>
        </View>

        {getResultBanner()}

        {/* Auto Scan Results List */}
        {attendanceMethod === 'scan' && scanResults.length > 0 && (
          <View style={styles.scanResultsContainer}>
            <Text style={styles.scanResultsHeaderTitle}>Kết quả nhận diện gần đây:</Text>
            <ScrollView 
              style={styles.scanResultsScrollView} 
              nestedScrollEnabled={true}
              contentContainerStyle={{ gap: 8 }}
            >
              {scanResults.map((item) => {
                let badgeBgColor = '#E2E8F0';
                let badgeTextColor = colors.textSecondary;
                let statusText = item.message;
                
                if (item.status === 'confirming') {
                  badgeBgColor = '#EFF6FF'; // light blue
                  badgeTextColor = colors.primary;
                } else if (item.status === 'present' || item.status === 'success') {
                  badgeBgColor = colors.successBg;
                  badgeTextColor = colors.success;
                  statusText = 'Có mặt';
                } else if (item.status === 'late') {
                  badgeBgColor = colors.warningBg;
                  badgeTextColor = colors.warning;
                  statusText = 'Đi muộn';
                } else if (item.status === 'already_marked') {
                  badgeBgColor = '#F1F5F9'; // light slate
                  badgeTextColor = colors.textMuted;
                  statusText = 'Đã điểm danh';
                } else if (item.status === 'unknown') {
                  badgeBgColor = '#FEF2F2'; // light red
                  badgeTextColor = colors.danger;
                  statusText = 'Không xác định';
                } else if (item.status === 'error') {
                  badgeBgColor = '#FFFBEB'; // light amber
                  badgeTextColor = colors.danger;
                  statusText = item.message || 'Lỗi';
                }

                return (
                  <View key={item.id} style={styles.scanResultRow}>
                    <View style={styles.scanResultLeft}>
                      <View style={[styles.scanResultAvatar, { backgroundColor: badgeBgColor }]}>
                        <Text style={[styles.scanResultAvatarText, { color: badgeTextColor }]}>
                          {item.status === 'unknown' ? '?' : (item.student_name?.[0]?.toUpperCase() || '✓')}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scanResultName} numberOfLines={1}>{item.student_name}</Text>
                        <Text style={styles.scanResultMeta}>
                          Độ tin cậy: {(item.confidence * 100).toFixed(1)}%
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.scanResultBadge, { backgroundColor: badgeBgColor }]}>
                      <Text style={[styles.scanResultBadgeText, { color: badgeTextColor }]}>
                        {statusText}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Auto Attendance Toggle */}
        {isFaceDetectorAvailable && attendanceMethod === 'photo' && (
          <AppPressable
            style={styles.toggleCard}
            onPress={() => setIsAutoMode(!isAutoMode)}
            scaleTo={0.98}
          >
            <LinearGradient
              colors={isAutoMode ? ['rgba(245,158,11,0.08)', 'rgba(245,158,11,0.03)'] : ['rgba(148,163,184,0.08)', 'rgba(148,163,184,0.03)']}
              style={styles.toggleCardInner}
            >
              <View style={styles.toggleLeft}>
                <View style={[styles.toggleIconBg, isAutoMode ? styles.toggleIconBgActive : styles.toggleIconBgInactive]}>
                  {isAutoMode ? (
                    <Zap color="#F59E0B" size={18} fill="#F59E0B" />
                  ) : (
                    <ZapOff color="#94A3B8" size={18} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Tự động quét khuôn mặt</Text>
                  <Text style={styles.toggleSubtitle} numberOfLines={1}>
                    {isAutoMode 
                      ? 'Camera tự động chụp khi phát hiện khuôn mặt' 
                      : 'Bấm nút bên dưới để chụp thủ công'}
                  </Text>
                </View>
              </View>
              <View style={[styles.switchTrack, isAutoMode ? styles.switchTrackActive : styles.switchTrackInactive]}>
                <View style={[styles.switchThumb, isAutoMode ? styles.switchThumbActive : styles.switchThumbInactive]} />
              </View>
            </LinearGradient>
          </AppPressable>
        )}

        {/* Chọn phương thức điểm danh */}
        <View style={styles.methodSelectorContainer}>
          <Text style={styles.methodSelectorTitle}>Phương thức điểm danh</Text>
          <View style={styles.methodTabs}>
            <AppPressable
              containerStyle={{ flex: 1 }}
              style={[styles.methodTab, attendanceMethod === 'photo' && styles.methodTabActive]}
              onPress={() => handleMethodChange('photo')}
              scaleEnabled={false}
            >
              <Text style={[styles.methodTabText, attendanceMethod === 'photo' && styles.methodTabTextActive]}>Chụp ảnh</Text>
            </AppPressable>
            <AppPressable
              containerStyle={{ flex: 1 }}
              style={[styles.methodTab, attendanceMethod === 'scan' && styles.methodTabActive]}
              onPress={() => handleMethodChange('scan')}
              scaleEnabled={false}
            >
              <Text style={[styles.methodTabText, attendanceMethod === 'scan' && styles.methodTabTextActive]}>Tự động quét</Text>
            </AppPressable>
          </View>
        </View>

        {/* Thanh trượt ngưỡng nhận diện (Chỉ hiện khi chọn Tự động quét) */}
        {attendanceMethod === 'scan' && (
          <View style={styles.attendanceSliderCard}>
            <Text style={styles.sliderCardTitle}>Ngưỡng nhận diện khuôn mặt</Text>
            
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabelText}>Dễ nhận diện</Text>
              <Text style={styles.sliderLabelText}>Chính xác hơn</Text>
            </View>
            
            <Slider
              style={styles.slider}
              minimumValue={0.30}
              maximumValue={0.90}
              step={0.05}
              value={threshold}
              onValueChange={(val) => setThreshold(Number(val.toFixed(2)))}
              onSlidingComplete={handleSaveThreshold}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
            
            <Text style={styles.sliderValueDisplay}>
              Ngưỡng hiện tại: <Text style={{ fontWeight: '800', color: colors.primary }}>{threshold.toFixed(2)}</Text>
            </Text>

            <Text style={styles.sliderHintText}>
              Ngưỡng thấp giúp dễ nhận diện hơn nhưng có thể tăng nguy cơ nhận nhầm. Ngưỡng cao giúp chính xác hơn nhưng có thể khó nhận ra hơn.
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
          {attendanceMethod === 'photo' ? (
            <View style={styles.actionRowVideo}>
              <AppPressable
                containerStyle={[styles.captureBtn, ((camStatus === 'processing' || camStatus === 'success') || !selectedSession) && styles.btnDisabled]}
                style={styles.captureBtnAnimated}
                onPress={() => captureFromCamera()}
                disabled={(camStatus === 'processing' || camStatus === 'success') || !permission?.granted}
                scaleTo={0.97}
              >
                <LinearGradient
                  colors={selectedSession ? [colors.primary, colors.primaryDark] : ['#94A3B8', '#94A3B8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.captureBtnInner}
                >
                  <Camera color="#fff" size={20} strokeWidth={2} />
                  <Text style={styles.captureBtnText}>
                    {selectedSession ? 'Chụp ảnh điểm danh' : 'Đang tải ca học...'}
                  </Text>
                </LinearGradient>
              </AppPressable>
              <AppPressable
                containerStyle={[styles.galleryBtn, (camStatus === 'processing' || camStatus === 'success') && styles.btnDisabled]}
                style={styles.galleryBtnInner}
                onPress={pickFromGallery}
                disabled={(camStatus === 'processing' || camStatus === 'success')}
                scaleTo={0.95}
              >
                <ImageIcon color={colors.primary} size={22} />
              </AppPressable>
            </View>
          ) : (
            <AppPressable
              containerStyle={[styles.scanActionBtn, !selectedSession && styles.btnDisabled]}
              style={styles.scanActionBtnAnimated}
              onPress={isScanning ? stopScanning : startScanning}
              disabled={!selectedSession}
              scaleTo={0.97}
            >
              <LinearGradient
                colors={isScanning ? [colors.danger, '#DC2626'] : (selectedSession ? ['#10B981', '#059669'] : ['#94A3B8', '#94A3B8'])}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.scanActionBtnInner}
              >
                <Scan color="#fff" size={20} strokeWidth={2} />
                <Text style={styles.scanActionBtnText}>
                  {isScanning ? 'Dừng quét khuôn mặt' : 'Bắt đầu quét tự động'}
                </Text>
              </LinearGradient>
            </AppPressable>
          )}
        </View>

        {/* Today Logs */}
        <View style={styles.logCard}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Điểm danh gần đây</Text>
            <View style={styles.logCountBadge}>
              <Text style={styles.logCountText}>{todayLogs.length}</Text>
            </View>
          </View>

          {todayLogs.length === 0 ? (
            <View style={styles.emptyLogWrap}>
              <Text style={styles.emptyLogIcon}>📋</Text>
              <Text style={styles.emptyLog}>Chưa có lượt điểm danh nào</Text>
            </View>
          ) : (
            todayLogs.map((r, idx) => {
              const isLatest = lastResult?.type === 'success' && lastResult.record?.id === r.id;
              const isLate = r.status === 'late';
              
              let pct = null;
              if (r.confidence !== null && r.confidence !== undefined) {
                const raw = Number(r.confidence);
                const pctValue = raw <= 1 ? raw * 100 : raw;
                pct = pctValue.toFixed(1) + "%";
              }

              return (
                <View key={r.id || `log-${idx}`} style={[styles.logRow, isLatest && styles.logRowHighlight]}>
                  <View style={[styles.logAvatar, isLatest && styles.logAvatarSuccess]}>
                    <Text style={[styles.logAvatarText, isLatest && { color: colors.success }]}>
                      {r.student_name?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.logName, isLatest && { color: colors.success }]}>{r.student_name}</Text>
                    <Text style={styles.logTime}>
                      {formatTime(r.timestamp)}
                      {pct ? `  Độ chính xác: ${pct}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.badge, isLate ? styles.badgeLate : styles.badgeOk]}>
                    <Text style={[styles.statusBadgeText, isLate ? styles.badgeTextLate : styles.badgeTextOk]}>
                      {isLate ? 'Muộn' : 'Đúng giờ'}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 100 },

  btnSecondary: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  sessionInfoCard: {
    borderRadius: radius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(79,110,247,0.2)',
  },
  sessionInfoBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: spacing.sm,
  },
  sessionInfoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sessionInfoName: { fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2, marginBottom: spacing.sm },
  sessionInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 },
  sessionInfoValue: { fontSize: 13, color: colors.primaryDark, fontWeight: '600' },

  cameraCard: {
    borderRadius: radius.xxl,
    overflow: 'hidden',
    backgroundColor: '#000',
    aspectRatio: 3 / 4,
    maxHeight: 420,
    marginBottom: spacing.md,
    ...shadow.lg,
  },
  camera: { flex: 1, width: '100%' },
  guideOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guideFrame: { width: 210, height: 210, position: 'relative', marginBottom: 48 },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: 'rgba(255,255,255,0.9)', borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 14 },
  cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 14 },
  cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 14 },
  cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 14 },

  statusOverlay: { position: 'absolute', bottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, maxWidth: '90%' },
  statusOverlayInfo: { backgroundColor: 'rgba(0,0,0,0.65)' },
  statusOverlaySuccess: { backgroundColor: 'rgba(16,185,129,0.92)' },
  statusOverlayError: { backgroundColor: 'rgba(239,68,68,0.92)' },
  statusOverlayText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  groupResultContainer: { marginBottom: spacing.md },
  groupResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, paddingHorizontal: 4 },
  groupResultTitle: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  groupResultStatOk: { fontSize: 12, fontWeight: '700', color: colors.success, backgroundColor: colors.successBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  groupResultStatErr: { fontSize: 12, fontWeight: '700', color: colors.danger, backgroundColor: '#FEF2F2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },

  resultCard: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderWidth: 1.5 },
  resultCardOk: { backgroundColor: colors.successBg, borderColor: 'rgba(16,185,129,0.25)' },
  resultCardLate: { backgroundColor: colors.warningBg, borderColor: 'rgba(245,158,11,0.25)' },
  resultCardWarn: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  resultLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  resultAvatar: { width: 44, height: 44, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  resultAvatarText: { fontSize: 18, fontWeight: '800' },
  resultName: { fontSize: 16, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultTime: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 3 },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#fff' },
  resultBadgeOk: { shadowColor: colors.success, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  resultBadgeLate: { shadowColor: colors.warning, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  resultBadgeText: { fontSize: 11, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  actionRowVideo: { flexDirection: 'row', gap: 12, width: '100%', alignItems: 'center' },
  captureBtn: { flex: 1, height: 52, borderRadius: radius.lg, overflow: 'hidden', ...shadow.primary },
  captureBtnAnimated: { flex: 1, width: '100%', height: '100%' },
  btnDisabled: { opacity: 0.6 },
  captureBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: spacing.sm },
  captureBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  galleryBtn: { width: 60, height: 52, borderRadius: radius.lg, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: 'rgba(79,110,247,0.15)', overflow: 'hidden' },
  galleryBtnInner: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  videoBtn: { borderRadius: radius.lg, overflow: 'hidden', shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  videoBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: spacing.sm },
  videoBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  thresholdInfoCard: {
    backgroundColor: 'rgba(79,110,247,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(79,110,247,0.12)',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  thresholdInfoText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },

  logCard: { backgroundColor: colors.surface, borderRadius: radius.xxl, padding: spacing.md, marginBottom: spacing.lg, ...shadow.card },
  logHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  logTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  logCountBadge: { marginLeft: 8, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  logCountText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  emptyLogWrap: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyLogIcon: { fontSize: 32, marginBottom: spacing.xs },
  emptyLog: { color: colors.textMuted, fontSize: 13 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  logRowHighlight: { backgroundColor: colors.successBg, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, borderBottomColor: 'transparent', borderRadius: radius.sm },
  logAvatar: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  logAvatarSuccess: { backgroundColor: colors.successBg },
  logAvatarText: { fontSize: 14, fontWeight: '800', color: colors.primary },
  logName: { fontSize: 14, fontWeight: '600', color: colors.text },
  logTime: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },
  badgeOk: { backgroundColor: colors.successBg },
  badgeLate: { backgroundColor: colors.warningBg },
  statusBadgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOk: { color: colors.success },
  badgeTextLate: { color: colors.warning },

  toggleCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(226,232,240,0.8)',
  },
  toggleCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  toggleIconBg: {
    width: 36,
    height: 36,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleIconBgActive: {
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  toggleIconBgInactive: {
    backgroundColor: 'rgba(148,163,184,0.15)',
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.1,
  },
  toggleSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: radius.pill,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: '#F59E0B',
  },
  switchTrackInactive: {
    backgroundColor: '#CBD5E1',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    ...shadow.sm,
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },
  switchThumbInactive: {
    alignSelf: 'flex-start',
  },
  methodSelectorContainer: {
    marginVertical: spacing.md,
    paddingHorizontal: 4,
  },
  methodSelectorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  methodTabs: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    backgroundColor: '#F1F5F9',
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
  },
  methodTab: {
    height: '100%',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  methodTabActive: {
    backgroundColor: '#FFFFFF',
    ...shadow.sm,
  },
  methodTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  methodTabTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  attendanceSliderCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  sliderCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sliderLabelText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderValueDisplay: {
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  sliderHintText: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  scanResultsContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
    maxHeight: 280,
  },
  scanResultsHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  scanResultsScrollView: {
    maxHeight: 220,
  },
  scanResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  scanResultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  scanResultAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanResultAvatarText: {
    fontSize: 14,
    fontWeight: '800',
  },
  scanResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  scanResultMeta: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  scanResultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  scanResultBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  scanActionBtn: {
    width: '100%',
    height: 52,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.primary,
  },
  scanActionBtnAnimated: {
    width: '100%',
    height: '100%',
  },
  scanActionBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    gap: spacing.sm,
  },
  scanActionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});

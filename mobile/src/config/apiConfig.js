import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'api_base_url';

/** Mặc định theo môi trường chạy app */
function getDefaultHost() {
  if (Platform.OS === 'android') {
    // Android Emulator trỏ về máy host
    return '10.0.2.2';
  }
  // iOS Simulator / thiết bị cùng LAN: đổi IP trong Cài đặt
  return 'localhost';
}

export function getDefaultApiBaseUrl() {
  return 'https://coexist-makeover-outing.ngrok-free.dev/api';
}

export async function getApiBaseUrl() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch (e) {
    // ignore
  }
  return getDefaultApiBaseUrl();
}

export async function setApiBaseUrl(url) {
  let trimmed = (url || '').trim().replace(/\/$/, '');
  if (!trimmed) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return getDefaultApiBaseUrl();
  }
  
  // Tự động thêm giao thức http:// nếu người dùng không nhập http:// hoặc https://
  if (!trimmed.match(/^https?:\/\//i)) {
    trimmed = `http://${trimmed}`;
  }
  
  // Loại bỏ các dấu double slash dư thừa (nhưng giữ lại ://)
  trimmed = trimmed.replace(/([^:]\/)\/+/g, "$1");
  
  const normalized = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  await AsyncStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export async function getApiRootForDisplay() {
  const base = await getApiBaseUrl();
  return base.replace(/\/api$/, '');
}

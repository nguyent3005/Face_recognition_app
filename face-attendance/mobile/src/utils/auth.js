import AsyncStorage from '@react-native-async-storage/async-storage';

export const setAccessToken = async (token) => {
  if (token) {
    await AsyncStorage.setItem('access_token', token);
  } else {
    await AsyncStorage.removeItem('access_token');
  }
};

export const getAccessToken = async () => {
  return await AsyncStorage.getItem('access_token');
};

export const setCurrentUser = async (user) => {
  if (user) {
    await AsyncStorage.setItem('current_user', JSON.stringify(user));
  } else {
    await AsyncStorage.removeItem('current_user');
  }
};

export const getCurrentUser = async () => {
  const user = await AsyncStorage.getItem('current_user');
  return user ? JSON.parse(user) : null;
};

export const clearAuth = async () => {
  await AsyncStorage.removeItem('access_token');
  await AsyncStorage.removeItem('current_user');
};

import React, { useState, useEffect, useCallback } from 'react';
import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SessionDetailScreen from './src/screens/SessionDetailScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import LoginScreen from './src/screens/LoginScreen';
import CustomTabBar from './src/components/CustomTabBar';
import { getAccessToken } from './src/utils/auth';
import { setUnauthorizedHandler } from './src/utils/api';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} />
      <Stack.Screen name="Students" component={StudentsScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
    checkAuth();
  }, [handleLogout]);

  const checkAuth = async () => {
    try {
      const token = await getAccessToken();
      setIsAuthenticated(!!token);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        {isAuthenticated ? (
            <Tab.Navigator
            tabBar={(props) => <CustomTabBar {...props} />}
            screenOptions={{ 
              headerShown: false,
              animation: Platform.OS === 'android' ? 'none' : 'fade',
              sceneContainerStyle: { backgroundColor: colors.background || '#F3F6FF' }
            }}
          >
            <Tab.Screen
              name="Home"
              component={HomeStack}
              options={({ route }) => {
                const routeName = getFocusedRouteNameFromRoute(route) ?? 'HomeMain';
                const showTabBar = ['HomeMain'].includes(routeName);
                return {
                  tabBarLabel: 'Tổng quan',
                  tabBarStyle: showTabBar ? undefined : { display: 'none' }
                };
              }}
            />
            <Tab.Screen
              name="History"
              component={HistoryScreen}
              options={{ tabBarLabel: 'Lịch sử' }}
            />
            <Tab.Screen name="Settings" options={{ tabBarLabel: 'Cài đặt' }}>
              {() => <SettingsScreen onLogout={handleLogout} />}
            </Tab.Screen>
          </Tab.Navigator>
        ) : (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});

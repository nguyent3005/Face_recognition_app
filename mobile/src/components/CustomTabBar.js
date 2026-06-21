import React, { useRef } from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Clock, Settings } from 'lucide-react-native';
import { colors } from '../theme';
import AppPressable from './AppPressable';

const TABS = {
  Home:       { label: 'Tổng quan', icon: Home },
  History:    { label: 'Lịch sử',   icon: Clock },
  Settings:   { label: 'Cài đặt',   icon: Settings },
};

const TabButton = React.memo(({ route, isFocused, onPress, tab }) => {
  const Icon = tab.icon;
  const color = isFocused ? colors.primary : '#98A2B3';

  return (
    <AppPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      style={styles.tabItem}
      androidScaleEnabled={false}
      scaleTo={0.96}
    >
      <View style={styles.tabInner}>
        <Icon color={color} size={24} strokeWidth={isFocused ? 2.2 : 2.0} />
        <Text 
          style={[styles.tabLabel, isFocused ? styles.activeTabLabel : styles.inactiveTabLabel]} 
          numberOfLines={1}
        >
          {tab.label}
        </Text>
      </View>
    </AppPressable>
  );
});

export default function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const lastTabPressRef = useRef(0);

  // Check if any route in the tab bar requests display: 'none'
  const focusedRoute = state.routes[state.index];
  const focusedDescriptor = descriptors[focusedRoute.key];
  const focusedOptions = focusedDescriptor?.options;
  if (focusedOptions?.tabBarStyle?.display === 'none') {
    return null;
  }

  return (
    <View style={[styles.bottomNavContainer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const tab = TABS[route.name] || { label: route.name, icon: Home };

        const onPress = () => {
          if (isFocused) return;
          
          const now = Date.now();
          if (now - lastTabPressRef.current < 250) return;
          lastTabPressRef.current = now;

          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          
          if (!event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TabButton 
            key={route.key}
            route={route}
            isFocused={isFocused}
            onPress={onPress}
            tab={tab}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNavContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#EEF1F5',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 12,
    textAlign: 'center',
    includeFontPadding: false,
  },
  activeTabLabel: {
    color: colors.primary,
    fontWeight: '700',
  },
  inactiveTabLabel: {
    color: '#98A2B3',
    fontWeight: '500',
  },
});

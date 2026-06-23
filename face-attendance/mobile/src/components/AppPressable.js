import React, { useRef } from 'react';
import { Pressable, Animated, Platform } from 'react-native';

export default function AppPressable({
  children,
  style,
  containerStyle,
  onPress,
  disabled = false,
  scaleEnabled = true,
  androidScaleEnabled = true,
  scaleTo = 0.97,
  ...props
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const isAnimationEnabled = () => {
    if (disabled) return false;
    if (!scaleEnabled) return false;
    if (Platform.OS === 'android' && !androidScaleEnabled) return false;
    return true;
  };

  const handlePressIn = () => {
    if (!isAnimationEnabled()) return;
    Animated.spring(scaleAnim, {
      toValue: scaleTo,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    if (!isAnimationEnabled()) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      android_ripple={null}
      android_disableSound={true}
      style={containerStyle}
      {...props}
    >
      {({ pressed }) => {
        // Resolve style if it's a function, object or array
        const resolvedStyle = typeof style === 'function' ? style({ pressed }) : style;
        
        return (
          <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, resolvedStyle]}>
            {typeof children === 'function' ? children({ pressed }) : children}
          </Animated.View>
        );
      }}
    </Pressable>
  );
}


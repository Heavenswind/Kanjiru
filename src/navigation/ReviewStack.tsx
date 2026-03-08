import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {ReviewStackParamList} from '../types/navigation';
import ReviewHomeScreen from '../screens/review/ReviewHomeScreen';
import ReviewSessionScreen from '../screens/review/ReviewSessionScreen';
import ReviewSummaryScreen from '../screens/review/ReviewSummaryScreen';

const Stack = createStackNavigator<ReviewStackParamList>();

const darkHeader = {
  headerStyle: {backgroundColor: '#0f0f1a'},
  headerTintColor: '#fff',
  headerTitleStyle: {color: '#fff'},
};

export default function ReviewStack() {
  return (
    <Stack.Navigator screenOptions={darkHeader}>
      <Stack.Screen
        name="ReviewHome"
        component={ReviewHomeScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="ReviewSession"
        component={ReviewSessionScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="ReviewSummary"
        component={ReviewSummaryScreen}
        options={{headerShown: false}}
      />
    </Stack.Navigator>
  );
}

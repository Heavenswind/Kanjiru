import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {LearnStackParamList} from '../types/navigation';
import LevelPickerScreen from '../screens/learn/LevelPickerScreen';
import KanjiListScreen from '../screens/learn/KanjiListScreen';
import KanjiDetailScreen from '../screens/learn/KanjiDetailScreen';
import LearnSessionScreen from '../screens/learn/LearnSessionScreen';

const Stack = createStackNavigator<LearnStackParamList>();

const darkHeader = {
  headerStyle: {backgroundColor: '#0f0f1a'},
  headerTintColor: '#fff',
  headerTitleStyle: {color: '#fff'},
};

export default function LearnStack() {
  return (
    <Stack.Navigator screenOptions={darkHeader}>
      <Stack.Screen
        name="LevelPicker"
        component={LevelPickerScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="LearnSession"
        component={LearnSessionScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="KanjiList"
        component={KanjiListScreen}
        options={({route}) => ({title: `N${route.params.jlptLevel} Kanji`})}
      />
      <Stack.Screen
        name="KanjiDetail"
        component={KanjiDetailScreen}
        options={{title: 'Kanji'}}
      />
    </Stack.Navigator>
  );
}

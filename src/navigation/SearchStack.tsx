import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import {SearchStackParamList} from '../types/navigation';
import SearchScreen from '../screens/search/SearchScreen';
import SearchDetailScreen from '../screens/search/SearchDetailScreen';

const Stack = createStackNavigator<SearchStackParamList>();

const darkHeader = {
  headerStyle: {backgroundColor: '#0f0f1a'},
  headerTintColor: '#fff',
  headerTitleStyle: {color: '#fff'},
};

export default function SearchStack() {
  return (
    <Stack.Navigator screenOptions={darkHeader}>
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="SearchDetail"
        component={SearchDetailScreen}
        options={{headerShown: false}}
      />
    </Stack.Navigator>
  );
}

import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Text} from 'react-native';
import {MainTabParamList} from '../types/navigation';
import LearnStack from './LearnStack';
import ReviewStack from './ReviewStack';
import SearchStack from './SearchStack';
import ProgressScreen from '../screens/progress/ProgressScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({label, focused}: {label: string; focused: boolean}) {
  return <Text style={{fontSize: 18, color: focused ? '#e94560' : '#555'}}>{label}</Text>;
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0f0f1a',
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#555',
      }}
    >
      <Tab.Screen
        name="LearnTab"
        component={LearnStack}
        options={{
          tabBarLabel: 'Learn',
          tabBarIcon: ({focused}) => <TabIcon label="学" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ReviewTab"
        component={ReviewStack}
        options={{
          tabBarLabel: 'Review',
          tabBarIcon: ({focused}) => <TabIcon label="復" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStack}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({focused}) => <TabIcon label="探" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ProgressTab"
        component={ProgressScreen}
        options={{
          tabBarLabel: 'Progress',
          tabBarIcon: ({focused}) => <TabIcon label="進" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({focused}) => <TabIcon label="設" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

import React, {useEffect} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import {RootStackParamList} from '../types/navigation';
import {useAuthStore} from '../stores/useAuthStore';
import {onAuthStateChange} from '../services/supabase/auth';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const {session, setSession} = useAuthStore();

  useEffect(() => {
    const {data} = onAuthStateChange(async (_event, s) => {
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, [setSession]);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown: false}}>
        {session ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

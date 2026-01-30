import React, { useState, Suspense, lazy } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import HomeScreen from './screens/HomeScreen';
import CameraScreenExpoGo from './screens/CameraScreenExpoGo';

// Lazy-load the full camera screen so native modules (vision-camera, tflite) are only
// loaded when needed. This prevents "something went wrong" in Expo Go on app start.
const CameraScreen = lazy(() => import('./screens/CameraScreen'));

const isExpoGo = Constants.appOwnership === 'expo';

interface KnownPerson {
  name: string;
  imageUri: string;
}

function CameraFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={styles.fallbackText}>Loading camera…</Text>
    </View>
  );
}

export default function App() {
  const [currentMode, setCurrentMode] = useState<'home' | 'camera' | 'photo'>('home');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [knownPeople, setKnownPeople] = useState<KnownPerson[]>([]);

  const handleOpenCamera = (people: KnownPerson[]) => {
    setKnownPeople(people);
    setCurrentMode('camera');
  };

  const handlePickImage = (uri: string) => {
    setSelectedImage(uri);
    setCurrentMode('photo');
  };

  const handleGoBack = () => {
    setCurrentMode('home');
    setSelectedImage(null);
  };

  return (
    <>
      <StatusBar style="light" />
      {currentMode === 'home' ? (
        <HomeScreen onOpenCamera={handleOpenCamera} onPickImage={handlePickImage} />
      ) : isExpoGo ? (
        selectedImage ? (
          <View style={styles.fallback}>
            <Image source={{ uri: selectedImage }} style={styles.pickedImage} resizeMode="contain" />
            <TouchableOpacity style={styles.backBtn} onPress={handleGoBack}>
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraScreenExpoGo onBack={handleGoBack} />
        )
      ) : (
        <Suspense fallback={<CameraFallback />}>
          <CameraScreen
            staticImageUri={selectedImage}
            onBack={handleGoBack}
            knownPeople={knownPeople}
          />
        </Suspense>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 16,
  },
  pickedImage: {
    flex: 1,
    width: '100%',
  },
  backBtn: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 20,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 16,
  },
});

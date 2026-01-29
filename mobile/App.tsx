import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import CameraScreen from './screens/CameraScreen';
import HomeScreen from './screens/HomeScreen';

interface KnownPerson {
  name: string;
  imageUri: string;
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
      ) : (
        <CameraScreen
          staticImageUri={selectedImage}
          onBack={handleGoBack}
          knownPeople={knownPeople}
        />
      )}
    </>
  );
}

import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    SafeAreaView,
    StatusBar,
    TextInput,
    ScrollView,
    Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface KnownPerson {
    name: string;
    imageUri: string;
}

interface HomeScreenProps {
    onOpenCamera: (knownPeople: KnownPerson[]) => void;
    onPickImage: (uri: string) => void;
}

export default function HomeScreen({ onOpenCamera, onPickImage }: HomeScreenProps) {
    const [knownPeople, setKnownPeople] = useState<KnownPerson[]>([]);
    const [enrollName, setEnrollName] = useState('');
    const [isManaging, setIsManaging] = useState(false);

    useEffect(() => {
        loadKnownPeople();
    }, []);

    const loadKnownPeople = async () => {
        try {
            const saved = await AsyncStorage.getItem('knownPeople');
            if (saved) {
                setKnownPeople(JSON.parse(saved));
            }
        } catch (e) {
            console.error('Failed to load known people', e);
        }
    };

    const saveKnownPeople = async (people: KnownPerson[]) => {
        try {
            setKnownPeople(people);
            await AsyncStorage.setItem('knownPeople', JSON.stringify(people));
        } catch (e) {
            console.error('Failed to save known people', e);
        }
    };

    const enrollPerson = async () => {
        if (!enrollName) {
            Alert.alert('Error', 'Please enter a name first');
            return;
        }

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'We need gallery access to enroll faces.');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            quality: 0.5,
        });

        if (!result.canceled) {
            const newPerson = { name: enrollName, imageUri: result.assets[0].uri };
            const updated = [...knownPeople, newPerson];
            await saveKnownPeople(updated);
            setEnrollName('');
            Alert.alert('Success', `${enrollName} enrolled successfully!`);
        }
    };

    const deletePerson = async (index: number) => {
        const updated = knownPeople.filter((_, i) => i !== index);
        await saveKnownPeople(updated);
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.header}>
                    <Text style={styles.title}>Visual Assistant</Text>
                    <Text style={styles.subtitle}>AI-powered companion for identification</Text>
                </View>

                {!isManaging ? (
                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={[styles.button, styles.cameraButton]}
                            onPress={() => onOpenCamera(knownPeople)}
                        >
                            <View style={styles.iconCircle}>
                                <Text style={styles.icon}>📷</Text>
                            </View>
                            <View style={styles.buttonTextContainer}>
                                <Text style={styles.buttonTitle}>Live Camera</Text>
                                <Text style={styles.buttonDescription}>Identify objects and friends</Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.galleryButton]}
                            onPress={async () => {
                                const result = await ImagePicker.launchImageLibraryAsync({
                                    mediaTypes: ['images'],
                                    allowsEditing: true,
                                    quality: 1,
                                });
                                if (!result.canceled) onPickImage(result.assets[0].uri);
                            }}
                        >
                            <View style={[styles.iconCircle, styles.galleryIconCircle]}>
                                <Text style={styles.icon}>🖼️</Text>
                            </View>
                            <View style={styles.buttonTextContainer}>
                                <Text style={styles.buttonTitle}>Analyze Photo</Text>
                                <Text style={styles.buttonDescription}>Identify contents of a photo</Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.manageButton]}
                            onPress={() => setIsManaging(true)}
                        >
                            <View style={[styles.iconCircle, styles.manageIconCircle]}>
                                <Text style={styles.icon}>👥</Text>
                            </View>
                            <View style={styles.buttonTextContainer}>
                                <Text style={styles.buttonTitle}>Known People</Text>
                                <Text style={styles.buttonDescription}>{knownPeople.length} people enrolled</Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.manageSection}>
                        <View style={styles.manageHeader}>
                            <TouchableOpacity onPress={() => setIsManaging(false)} style={styles.backLink}>
                                <Text style={styles.backLinkText}>← Back to Menu</Text>
                            </TouchableOpacity>
                            <Text style={styles.manageTitle}>Manage People</Text>
                        </View>

                        <View style={styles.enrollCard}>
                            <Text style={styles.cardTitle}>Enroll New Friend</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Name (e.g. John)"
                                placeholderTextColor="#64748b"
                                value={enrollName}
                                onChangeText={setEnrollName}
                            />
                            <TouchableOpacity style={styles.enrollButton} onPress={enrollPerson}>
                                <Text style={styles.enrollButtonText}>Pick & Enroll Photo</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.listContainer}>
                            <Text style={styles.listTitle}>Enrolled People</Text>
                            {knownPeople.map((person, index) => (
                                <View key={index} style={styles.personItem}>
                                    <View style={styles.personInfo}>
                                        <View style={styles.avatar}>
                                            <Text style={styles.avatarText}>{person.name[0]?.toUpperCase()}</Text>
                                        </View>
                                        <Text style={styles.personName}>{person.name}</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => deletePerson(index)}>
                                        <Text style={styles.deleteIcon}>🗑️</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                            {knownPeople.length === 0 && (
                                <Text style={styles.emptyText}>No one enrolled yet.</Text>
                            )}
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f172a',
    },
    scrollContent: {
        padding: 24,
        paddingBottom: 60,
    },
    header: {
        alignItems: 'center',
        marginTop: 40,
        marginBottom: 40,
    },
    title: {
        fontSize: 36,
        fontWeight: '800',
        color: '#fff',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        color: '#94a3b8',
        textAlign: 'center',
        lineHeight: 20,
    },
    buttonContainer: {
        gap: 16,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    cameraButton: {},
    galleryButton: {},
    manageButton: {},
    iconCircle: {
        width: 60,
        height: 60,
        borderRadius: 18,
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    galleryIconCircle: {
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
    },
    manageIconCircle: {
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
    },
    icon: {
        fontSize: 26,
    },
    buttonTextContainer: {
        flex: 1,
    },
    buttonTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#fff',
        marginBottom: 4,
    },
    buttonDescription: {
        fontSize: 13,
        color: '#64748b',
    },
    manageSection: {
        flex: 1,
    },
    manageHeader: {
        marginBottom: 24,
    },
    backLink: {
        marginBottom: 12,
    },
    backLinkText: {
        color: '#94a3b8',
        fontSize: 14,
    },
    manageTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    enrollCard: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 20,
        padding: 20,
        marginBottom: 24,
    },
    cardTitle: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
    },
    input: {
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: 12,
        padding: 12,
        color: '#fff',
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    enrollButton: {
        backgroundColor: '#9333ea',
        borderRadius: 12,
        padding: 14,
        alignItems: 'center',
    },
    enrollButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
    listContainer: {
        flex: 1,
    },
    listTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
    },
    personItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.03)',
        padding: 16,
        borderRadius: 16,
        marginBottom: 10,
    },
    personInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(147, 51, 234, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        color: '#a855f7',
        fontWeight: 'bold',
    },
    personName: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
    },
    deleteIcon: {
        fontSize: 20,
    },
    emptyText: {
        color: '#475569',
        textAlign: 'center',
        marginTop: 20,
    },
});

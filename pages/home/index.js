import React, { useEffect, useRef, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import ThemedText from "../../components/themed-text";
import { useTheme } from "@react-navigation/native";
import MapView, { Polyline } from "react-native-maps";
import { decode } from "@googlemaps/polyline-codec";
import { googleMapsStyling } from "../../maps/google-maps-styling";
import * as Location from "expo-location";
import RecenterButton from "../../components/recenter-button";
import AccountModal from "../../components/account-modal";
import ThemedTextMarquee from "../../components/themed-text-marquee";
import BottomCard from "../../components/bottom-card";
import SearchBox from "../../components/search-box";
import BottomCardFlatList from "../../components/bottom-card-flat-list";
import axios from "axios";
import { configs } from "../../configs/configs";

const INITIAL_MAP_REGION = {
    latitude: 13.764889,
    longitude: 100.538266,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
};

export default function Home() {
    const { colors } = useTheme();
    const mapRef = useRef();
    const [mapsIsRecentered, setMapsIsRecentered] = useState(false);
    const [location, setLocation] = useState(null);
    const [mapCurrentLocationRegion, setMapCurrentLocationRegion] = useState({});
    const [locationErrorMessage, setLocationErrorMessage] = useState(null);

    const [nearbyStations, setNearbyStations] = useState([]);

    const styles = StyleSheet.create({
        container: {
            backgroundColor: colors.background,
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
        },
        text: {
            fontSize: 32,
            fontWeight: "bold",
        },
        maps: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
        },
        searchbox: {
            justifyContent: "space-between",
            paddingHorizontal: 40,
            bottom: 25,
            right: 25,
        },
        accountbox: {
            bottom: 70,
            left: 370,
        },
        flatlistcontainer: {
            flex: 1,
            bottom: 50,
            // marginLeft:"auto",
            // marginRight:"auto",
        },
        bottomcard: {
            bottom: -550,
            justifyContent: "center",
            alignItems: "center",
        },
    });

    useEffect(() => {
        (async () => {
            recenter();
        })().catch(() => {});
    }, []);

    async function fetchNewLocation() {
        let { status } = await Location.requestForegroundPermissionsAsync().catch(() => {});
        if (status !== "granted") {
            setLocationErrorMessage("Location permission is denied");
            return;
        }

        let location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
        }).catch(() => {});

        setLocation(location);
        setMapCurrentLocationRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
        });

        return {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
        };
    }

    async function recenter() {
        mapRef.current.animateToRegion(
            (await fetchNewLocation().catch(() => {})) || INITIAL_MAP_REGION,
        );
        setMapsIsRecentered(true);
    }

    function decodePolyline() {
        const decoded = decode(polyline, 5);
        console.log(decoded);
        let decodedPolyline = [];

        decoded.forEach((element) => {
            decodedPolyline.push({ latitude: element[0], longitude: element[1] });
        });

        return decodedPolyline;
    }

    function fetchNearbyStations(region) {
        console.log(
            `${configs.API_URL}/station/nearby?lat=${region.latitude}&lng=${
                region.longitude
            }&radius=${region.latitudeDelta * 111045}`,
        );
        axios
            .get(
                `${configs.API_URL}/station/nearby?lat=${region.latitude}&lng=${
                    region.longitude
                }&radius=${region.latitudeDelta * 111045}`,
            )
            .then((response) => {
                console.log("fetched");
                setNearbyStations(response.data.data);
                console.log(response.data.data);
            })
            .catch((error) => {
                console.log(error);
                setNearbyStations([]);
            });
    }

    function onMapRegionChangeComplete(region) {
        console.log(region);
        fetchNearbyStations(region);
    }

    return (
        <View style={styles.container}>
            {/* <ThemedTextMarquee style={{ fontSize: 40, fontWeight: "bold" }}>
                Please mind the gap between the train and the platform. This is Aldgate. This is a
                Circle line train via Liverpool Street and King’s Cross St. Pancras
            </ThemedTextMarquee> */}
            <SafeAreaView />
            <MapView
                ref={mapRef}
                style={styles.maps}
                initialRegion={INITIAL_MAP_REGION}
                provider="google"
                customMapStyle={googleMapsStyling}
                onTouchStart={() => setMapsIsRecentered(false)}
                onRegionChangeComplete={(region) => onMapRegionChangeComplete(region)}
                showsUserLocation
            ></MapView>
            <RecenterButton recentered={mapsIsRecentered} onPress={recenter} />
            <View style={styles.bottomcard}>
                <BottomCard>
                    <View style={styles.searchbox}>
                        <SearchBox />
                    </View>
                    <View style={styles.accountbox}>
                        <AccountModal />
                    </View>
                    <View style={styles.flatlistcontainer}>
                        <BottomCardFlatList
                            latitude={location ? location.latitude : INITIAL_MAP_REGION.latitude}
                            longitude={location ? location.longitude : INITIAL_MAP_REGION.longitude}
                            radius={2000}
                        />
                    </View>
                </BottomCard>
            </View>
        </View>
    );
}

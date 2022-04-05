import { StyleSheet, View, Animated, Easing } from "react-native";
import React, { useRef, useEffect, useState } from "react";
import ThemedText from "../../components/themed-text";
import { useTheme } from "@react-navigation/native";
import MapView, { AnimatedRegion, Marker, Polyline } from "react-native-maps";
import { googleMapsStyling } from "../../maps/google-maps-styling";
import * as Location from "expo-location";
import axios from "axios";
import { configs, getRouteTypeString, pSBC } from "../../configs/configs";
import { decode } from "@googlemaps/polyline-codec";
import ArrowIcon from "../../assets/svgs/arrow-forward-18px";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import dayjs from "dayjs";
import {
    getCurrentETA,
    getDistanceFromLatLonInKm,
    getTotalDistanceOfRoute,
    ROUTE_DETAILS,
    snapToPolyline,
} from "./util";
import RecenterButton from "../../components/recenter-button";
import ExpandDownIcon18px from "../../assets/svgs/expand-down-icon-18px";
import SvgAnimatedLinearGradient from "react-native-svg-animated-linear-gradient/src";

const CHECKPOINT_SNAP_DISTANCE = 0.1;

const INITIAL_MAP_REGION = {
    latitude: 13.764889,
    longitude: 100.538266,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
};

const Navigation = () => {
    const { colors, dark } = useTheme();
    let firstRun = true;
    const mapRef = useRef(null);
    const currentLocationMarkerRef = useRef(null);
    const SAFE_AREA = useSafeAreaInsets();

    const [isRecentered, setIsRecentered] = useState(true);

    const [location, setLocation] = useState(undefined);
    const [mapsCurrentLocationRegion, setMapCurrentLocationRegion] = useState(undefined);
    const [locationErrorMessage, setLocationErrorMessage] = useState(null);
    const [polylines, setPolylines] = useState([]);
    const [passedPolylines, setPassedPolylines] = useState([]);
    const [directions, setDirections] = useState([]);
    const [currentDirection, setCurrentDirection] = useState(undefined);
    const [nearestPointOnPolyline, setNearestPointOnPolyline] = useState(undefined);
    const [nearestPointOnPolylineAnimated, setNearestPointOnPolylineAnimated] = useState(undefined);
    const [offRoad, setOffRoad] = useState(false);

    const [ETAs, setETAs] = useState([]);
    const [currentETA, setCurrentETA] = useState(0);

    const [navigationDone, setNavigationDone] = useState(false);
    const [doneSubviewWidth, setDoneSubviewWidth] = useState(new Animated.Value(0));
    const [bottomNavigationPanelViewWidth, setBottomNavigationPanelViewWidth] = useState(0);

    useEffect(() => {
        let subscribed = true;

        if (subscribed) {
            if (firstRun) {
                (async () => {
                    fetchNewLocation(true);
                    parsePolylines();
                })().catch(() => {});
                firstRun = false;
            }

            setInterval(async () => fetchNewLocation(false), 100);
        }

        return () => {
            subscribed = false;
        };
    }, []);

    useEffect(() => {
        if (polylines.length !== 0) parseDirections();
    }, [polylines]);

    useEffect(() => {
        let subscribed = true;

        if (subscribed) {
            console.log("location updated");

            if (polylines.length !== 0 && location) {
                let snapped = snapToPolyline(polylines, location);
                if (snapped) {
                    if (
                        !nearestPointOnPolylineAnimated ||
                        (nearestPointOnPolylineAnimated.latitude !==
                            snapped.interpolatedCoordinatesOnPolyline.latitude &&
                            nearestPointOnPolylineAnimated.longitude !==
                                snapped.interpolatedCoordinatesOnPolyline.longitude)
                    ) {
                        if (!nearestPointOnPolylineAnimated) {
                            setNearestPointOnPolylineAnimated(
                                new AnimatedRegion({
                                    ...snapped.interpolatedCoordinatesOnPolyline,
                                }),
                            );
                        } else {
                            if (Platform.OS === "android") {
                                if (marker) {
                                    currentLocationMarkerRef.animateMarkerToCoordinate(
                                        snapped.interpolatedCoordinatesOnPolyline,
                                        10,
                                    );
                                }
                                addToPassedPolylines(snapped.interpolatedCoordinatesOnPolyline);
                            } else {
                                nearestPointOnPolylineAnimated
                                    .timing({
                                        latitude:
                                            snapped.interpolatedCoordinatesOnPolyline.latitude,
                                        longitude:
                                            snapped.interpolatedCoordinatesOnPolyline.longitude,
                                        duration: 50,
                                    })
                                    .start((finished) => {
                                        if (finished) {
                                            addToPassedPolylines(
                                                snapped.interpolatedCoordinatesOnPolyline,
                                            );
                                        }
                                    });
                            }
                        }

                        setNearestPointOnPolyline({
                            latitude: snapped.interpolatedCoordinatesOnPolyline.latitude,
                            longitude: snapped.interpolatedCoordinatesOnPolyline.longitude,
                        });

                        setOffRoad(snapped.offRoad);
                        determineCurrentDirection();
                        determineCurrentETA();
                        determineNavigationDone();
                    }
                }
            }
        }

        return () => {
            subscribed = false;
        };
    }, [location]);

    async function fetchNewLocation(doRecenter) {
        let { status } = await Location.requestForegroundPermissionsAsync().catch(() => {});
        if (status !== "granted") {
            setLocationErrorMessage("Location permission is denied");
            return;
        }

        Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
        })
            .then((location) => {
                // console.log("location fetched", location);
                setLocation({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                });
                setMapCurrentLocationRegion({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                });

                if (doRecenter) {
                    recenter({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.005,
                        longitudeDelta: 0.005,
                    });
                }

                return {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                };
            })
            .catch(() => {});
    }

    async function recenter(region) {
        console.log("recentring");
        setIsRecentered(true);
        mapRef.current.animateToRegion(region || INITIAL_MAP_REGION);
    }

    function decodePolyline(polyline) {
        const decoded = decode(polyline, 5);
        let decodedPolyline = [];

        decoded.forEach((element) => {
            decodedPolyline.push({ latitude: element[0], longitude: element[1] });
        });

        return decodedPolyline;
    }

    function determineCurrentDirection() {
        if (nearestPointOnPolyline) {
            let nearestDistance = Infinity;
            let nearestKey = "";

            Object.keys(directions).map((key) => {
                let distance = getDistanceFromLatLonInKm(
                    directions[key].near.lat,
                    directions[key].near.lng,
                    nearestPointOnPolyline.latitude,
                    nearestPointOnPolyline.longitude,
                );

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestKey = key;
                }
            });

            if (!currentDirection) {
                setCurrentDirection(directions[nearestKey]);
                return;
            }

            if (nearestDistance <= CHECKPOINT_SNAP_DISTANCE) {
                if (
                    currentDirection.near.lat !== directions[nearestKey].near.lat &&
                    currentDirection.near.lng !== directions[nearestKey].near.lng
                ) {
                    setCurrentDirection(directions[nearestKey]);
                }
            }
        }
    }

    function determineCurrentETA() {
        if (currentDirection) {
            let currentPolyline = polylines.find((p) => p.route_id === currentDirection.route_id);

            let etaOfCurrentRoute = getCurrentETA(
                currentDirection,
                ETAs,
                currentPolyline,
                location,
            );

            let tempETAs = [...ETAs];

            for (let i = 0; i < tempETAs.length; i++) {
                if (tempETAs[i].route_id === currentDirection.route_id) {
                    tempETAs[i].current_eta = etaOfCurrentRoute;
                }
            }

            let totalETA = 0;
            for (let i = 0; i < tempETAs.length; i++) {
                totalETA += tempETAs[i].current_eta;
            }

            setETAs(tempETAs);
            setCurrentETA(totalETA);
        }
    }

    function determineNavigationDone() {
        if (!currentDirection) return;

        if (currentDirection.arrive) {
            onNavigationDone();
        }
    }

    async function parsePolylines() {
        let tempPolylines = [];

        for (let direction of ROUTE_DETAILS.directions) {
            if (direction.type === "walk") {
                tempPolylines.push({
                    route_id: `walk_from_${direction.from.coordinates.lat}_${direction.from.coordinates.lng}_to_${direction.to.coordinates.lat}_${direction.to.coordinates.lng}`,
                    polyline: decodePolyline(direction.route.overview_polyline.points),
                    color: colors.go_button,
                });
            } else if (direction.type === "board") {
                try {
                    let shapeEncoded = await getShape(
                        direction.via_line.id,
                        direction.from.coordinates,
                        direction.to.coordinates,
                    );

                    tempPolylines.push({
                        route_id: direction.via_line.id,
                        polyline: decodePolyline(shapeEncoded),
                        color: `#${direction.via_line.color}`,
                    });
                } catch (error) {
                    console.error(error.message);
                }
            }
        }

        setPolylines([...tempPolylines]);
    }

    async function getShape(routeId, fromCoordinates, toCoordinates) {
        let response = await axios.get(
            `${configs.API_URL}/shape/${routeId}?from=${fromCoordinates.lat},${fromCoordinates.lng}&to=${toCoordinates.lat},${toCoordinates.lng}`,
            {
                headers: {
                    Authorization: `Bearer ${configs.PERSISTENT_JWT}`,
                },
            },
        );

        if (response.data.data) {
            if (response.data.data.shape_encoded) return response.data.data.shape_encoded;
        }

        return;
    }

    function parseDirections() {
        let tempDirections = [];
        let tempETAs = [];

        for (let i in ROUTE_DETAILS.directions) {
            if (ROUTE_DETAILS.directions[i].type === "board") {
                let boardDirection = {
                    text: `Board ${getRouteTypeString(
                        ROUTE_DETAILS.directions[i].via_line.type || "0",
                        false,
                    )} from ${ROUTE_DETAILS.directions[i].from.station.name.en} to ${
                        ROUTE_DETAILS.directions[i].to.station.name.en
                    }`,
                };

                let alightDirection = {
                    text: `Alight at ${ROUTE_DETAILS.directions[i].to.station.name.en}`,
                };

                for (let j in ROUTE_DETAILS.directions[i].passing) {
                    if (parseInt(j) < ROUTE_DETAILS.directions[i].passing.length - 2) {
                        let snappedCoordinates = snapToPolyline(polylines, {
                            latitude: ROUTE_DETAILS.directions[i].passing[j].coordinates.lat,
                            longitude: ROUTE_DETAILS.directions[i].passing[j].coordinates.lng,
                        });

                        tempDirections.push({
                            ...boardDirection,
                            route_id: ROUTE_DETAILS.directions[i].via_line.id,
                            near: {
                                lat: snappedCoordinates.interpolatedCoordinatesOnPolyline.latitude,
                                lng: snappedCoordinates.interpolatedCoordinatesOnPolyline.longitude,
                            },
                            subtext: `Next: ${
                                ROUTE_DETAILS.directions[i].passing[parseInt(j) + 1].station.name.en
                            }`,
                            arrive: false,
                        });
                    } else {
                        let snappedCoordinates = snapToPolyline(polylines, {
                            latitude: ROUTE_DETAILS.directions[i].passing[j].coordinates.lat,
                            longitude: ROUTE_DETAILS.directions[i].passing[j].coordinates.lng,
                        });

                        tempDirections.push({
                            ...alightDirection,
                            route_id: ROUTE_DETAILS.directions[i].via_line.id,
                            near: {
                                lat: snappedCoordinates.interpolatedCoordinatesOnPolyline.latitude,
                                lng: snappedCoordinates.interpolatedCoordinatesOnPolyline.longitude,
                            },
                            arrive: false,
                        });
                        break;
                    }
                }

                let currentPolyline = polylines.find(
                    (p) => p.route_id === ROUTE_DETAILS.directions[i].via_line.id,
                );

                tempETAs.push({
                    route_id: ROUTE_DETAILS.directions[i].via_line.id,
                    eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    current_eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    distance: getTotalDistanceOfRoute(currentPolyline.polyline),
                });
            } else if (ROUTE_DETAILS.directions[i].type === "walk") {
                for (let step of ROUTE_DETAILS.directions[i].route.steps) {
                    tempDirections.push({
                        distance: { text: `In ${step.distance.text}`, value: step.distance.value },
                        route_id: `walk_from_${direction.from.coordinates.lat}_${direction.from.coordinates.lng}_to_${direction.to.coordinates.lat}_${direction.to.coordinates.lng}`,
                        text: htmlToText(step.html_instructions),
                        near: ROUTE_DETAILS.directions[i].start_location,
                        arrive: false,
                    });
                }

                let currentPolyline = polylines.find(
                    (p) => p.route_id === ROUTE_DETAILS.directions[i].via_line.id,
                );

                tempETAs.push({
                    route_id: `walk_from_${direction.from.coordinates.lat}_${direction.from.coordinates.lng}_to_${direction.to.coordinates.lat}_${direction.to.coordinates.lng}`,
                    eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    current_eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    distance: getTotalDistanceOfRoute(currentPolyline.polyline),
                });
            } else if (ROUTE_DETAILS.directions[i].type === "transfer") {
                let snappedCoordinates = snapToPolyline(polylines, {
                    latitude: ROUTE_DETAILS.directions[i].from.coordinates.lat,
                    longitude: ROUTE_DETAILS.directions[i].from.coordinates.lng,
                });

                tempDirections.push({
                    text: `Transfer from ${ROUTE_DETAILS.directions[i].from.station.name.en} to ${ROUTE_DETAILS.directions[i].to.station.name.en}`,
                    near: {
                        lat: snappedCoordinates.interpolatedCoordinatesOnPolyline.latitude,
                        lng: snappedCoordinates.interpolatedCoordinatesOnPolyline.longitude,
                    },
                    arrive: false,
                });

                tempETAs.push({
                    eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    current_eta: ROUTE_DETAILS.directions[i].schedule.duration,
                });
            }

            if (parseInt(i) === ROUTE_DETAILS.directions.length - 1) {
                if (ROUTE_DETAILS.directions[i].type === "walk") {
                    tempDirections.push({
                        text: `You have arrived at ${ROUTE_DETAILS.directions[i].to.place.address}`,
                        route_id: `walk_from_${direction.from.coordinates.lat}_${direction.from.coordinates.lng}_to_${direction.to.coordinates.lat}_${direction.to.coordinates.lng}`,
                        near: ROUTE_DETAILS.directions[i].to.coordinates,
                        arrive: true,
                    });
                } else if (ROUTE_DETAILS.directions[i].type === "board") {
                    let snappedCoordinates = snapToPolyline(polylines, {
                        latitude: ROUTE_DETAILS.destination.coordinates.lat,
                        longitude: ROUTE_DETAILS.destination.coordinates.lng,
                    });

                    tempDirections.push({
                        text: `You have arrived at ${ROUTE_DETAILS.destination.station.name.en}`,
                        route_id: ROUTE_DETAILS.directions[i].via_line.id,
                        near: {
                            lat: snappedCoordinates.interpolatedCoordinatesOnPolyline.latitude,
                            lng: snappedCoordinates.interpolatedCoordinatesOnPolyline.longitude,
                        },
                        arrive: true,
                    });
                }
            }
        }

        setETAs([...tempETAs]);
        setDirections([...tempDirections]);
    }

    function addToPassedPolylines(coordinates) {
        setPassedPolylines([...passedPolylines, coordinates]);
    }

    function onNavigationDone() {
        if (!navigationDone) {
            console.log("DONEDONEDONE");
            console.log(currentDirection);
            setNavigationDone(true);

            Animated.timing(doneSubviewWidth, {
                toValue: bottomNavigationPanelViewWidth - 20,
                duration: 4000,
                easing: Easing.linear,
                useNativeDriver: false,
            }).start();
        }
    }

    function htmlToText(html) {
        let response = html.replaceAll(`<div style=\"font-size:0.9em\">`, "<div> ");
        response = response.replaceAll(/<[^>]+>/g, "");
        response = response.replaceAll("&nbsp;", " ");

        return response;
    }

    function onMapRegionChange() {
        setIsRecentered(false);
    }

    function onRecenterButtonPress() {
        setIsRecentered(true);
    }

    const styles = StyleSheet.create({
        container: {
            backgroundColor: colors.background,
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
        },
        maps: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
        },
        marker: {
            width: 20,
            height: 20,
            borderRadius: 30,
            borderWidth: 2.5,
        },
        topNavigationPanelContainerWithSafeAreaContainer: {
            position: "absolute",
            top: 0,
            width: "100%",
            paddingHorizontal: 10,
            paddingTop: SAFE_AREA.top,
        },
        topNavigationPanelContainer: {
            width: "100%",
            borderRadius: 12,
            backgroundColor: colors.background,
            padding: 18,

            shadowColor: colors.shadow,
            shadowOffset: {
                width: 0,
                height: 5,
            },
            shadowOpacity: 0.34,
            shadowRadius: 6.27,

            elevation: 10,
        },
        bottomNavigationPanelContainerWithSafeAreaContainer: {
            position: "absolute",
            bottom: 0,
            width: "100%",
            paddingHorizontal: 10,
            paddingBottom: SAFE_AREA.bottom,
        },
        bottomNavigationPanelContainer: {
            width: "100%",
            borderRadius: 12,
            backgroundColor: colors.background,
            padding: 18,

            shadowColor: colors.shadow,
            shadowOffset: {
                width: 0,
                height: 5,
            },
            shadowOpacity: 0.34,
            shadowRadius: 6.27,

            elevation: 10,
        },
        bottomNavigationPanelTitle: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
        },
        bottomNaviationPanelTitleArrowIcon: {
            marginLeft: 5,
        },
        onGoingNavigationText: {
            color: colors.subtitle,
            fontSize: 16,
        },
        bottomNavigationPanelArrivingInContainer: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            marginTop: 5,
        },
        bottomNavigationPanelArrivingInText: {
            color: colors.text,
            fontWeight: "600",
            fontSize: 24,
        },
        bottomNavigationPanelTimeText: {
            color: colors.primary,
            fontWeight: "600",
            fontSize: 24,
            marginLeft: 5,
        },
        bottomNavigationPanelETAText: {
            color: colors.subtitle,
            fontWeight: "600",
            fontSize: 24,
            marginLeft: 5,
        },
        topNavigationPanelDistanceText: {
            color: colors.subtitle,
            fontWeight: "600",
            fontSize: 18,
        },
        topNavigationPanelDirectionText: {
            color: colors.text,
            fontWeight: "600",
            fontSize: 24,
        },
        offRoadContainer: {
            alignSelf: "flex-end",
            marginTop: 10,
            borderRadius: 12,
            backgroundColor: colors.upper_background,
            padding: 15,

            shadowColor: colors.shadow,
            shadowOffset: {
                width: 0,
                height: 5,
            },
            shadowOpacity: 0.34,
            shadowRadius: 6.27,

            elevation: 10,
        },
        offRoadText: {
            color: colors.text,
            fontWeight: "600",
            fontSize: 18,
        },
        recenterButton: {
            marginBottom: 10,
            marginRight: 0,
        },
        topNavigationPanelSubtextContainer: {
            width: "auto",
            borderRadius: 12,
            backgroundColor: colors.background,
            paddingHorizontal: 18,
            paddingVertical: 14,
            marginTop: 5,

            shadowColor: colors.shadow,
            shadowOffset: {
                width: 0,
                height: 5,
            },
            shadowOpacity: 0.34,
            shadowRadius: 6.27,

            elevation: 10,
        },
        topNavigationPanelSubtext: {
            marginTop: 5,
            color: colors.subtitle,
            fontWeight: "600",
            fontSize: 16,
        },
        bottomNavigationExpandUpIcon: {
            alignSelf: "flex-end",
            marginRight: 0,
            marginLeft: "auto",
        },
        currentLocationMarker: {
            width: 20,
            height: 20,
            borderRadius: 30,
            borderWidth: 2.5,
            backgroundColor: colors.go_button,
            borderColor: colors.white,
            zIndex: 100,
        },
        doneText: {
            color: colors.text,
            fontSize: 18,
            fontWeight: "600",
            paddingVertical: 16,
        },
        bottomDoneSubview: {
            alignSelf: "flex-start",
            height: "100%",
            backgroundColor: colors.upper_background,
            position: "absolute",
        },
    });

    const BottomDoneNavigationPanel = () => (
        <View
            style={{
                ...styles.bottomNavigationPanelContainerWithSafeAreaContainer,
                zIndex: 10,
            }}
        >
            <View
                style={{
                    ...styles.bottomNavigationPanelContainer,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    padding: 0,
                    margin: 0,
                }}
            >
                <Animated.View
                    style={[styles.bottomDoneSubview, { width: doneSubviewWidth }]}
                ></Animated.View>
                <ThemedText style={styles.doneText}>Done</ThemedText>
            </View>
        </View>
    );

    const TopNavigationPanel = () => (
        <>
            <View style={styles.topNavigationPanelContainerWithSafeAreaContainer}>
                <View style={styles.topNavigationPanelContainer}>
                    {currentDirection && (
                        <>
                            {currentDirection.distance && (
                                <ThemedText style={styles.topNavigationPanelDistanceText}>
                                    {currentDirection.distance.text}
                                </ThemedText>
                            )}
                            {currentDirection.text && (
                                <ThemedText style={styles.topNavigationPanelDirectionText}>
                                    {currentDirection.text}
                                </ThemedText>
                            )}

                            {currentDirection.subtext && (
                                <ThemedText style={styles.topNavigationPanelSubtext}>
                                    {currentDirection.subtext}
                                </ThemedText>
                            )}
                        </>
                    )}
                    {!currentDirection && (
                        <>
                            <SvgAnimatedLinearGradient
                                width="80%"
                                height={20}
                                primaryColor={colors.upper_background}
                                secondaryColor={colors.background}
                            />
                            <SvgAnimatedLinearGradient
                                style={{ marginTop: 5 }}
                                width="50%"
                                height={16}
                                primaryColor={colors.upper_background}
                                secondaryColor={colors.background}
                            />
                        </>
                    )}
                </View>

                {offRoad && (
                    <View style={styles.offRoadContainer}>
                        <ThemedText style={styles.offRoadText}>Off road</ThemedText>
                    </View>
                )}
            </View>
        </>
    );

    const BottomNavigationPanel = () => (
        <View
            style={styles.bottomNavigationPanelContainerWithSafeAreaContainer}
            onLayout={(event) => setBottomNavigationPanelViewWidth(event.nativeEvent.layout.width)}
        >
            {!isRecentered && (
                <RecenterButton
                    style={styles.recenterButton}
                    recentered={isRecentered}
                    onPress={() => {
                        onRecenterButtonPress();
                    }}
                />
            )}
            <View style={styles.bottomNavigationPanelContainer}>
                <View style={styles.bottomNavigationPanelTitle}>
                    <ThemedText style={styles.onGoingNavigationText}>
                        On-going navigation
                    </ThemedText>
                    <ArrowIcon style={styles.bottomNaviationPanelTitleArrowIcon} />
                    <ExpandDownIcon18px style={styles.bottomNavigationExpandUpIcon} />
                </View>
                <View style={styles.bottomNavigationPanelArrivingInContainer}>
                    <ThemedText style={styles.bottomNavigationPanelArrivingInText}>
                        Arriving in
                    </ThemedText>
                    <ThemedText style={styles.bottomNavigationPanelTimeText}>
                        {Math.round(currentETA / 60)} min
                    </ThemedText>
                    <ThemedText style={styles.bottomNavigationPanelETAText}>
                        · {dayjs().add(currentETA, "second").format("HH:mm")}
                    </ThemedText>
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <MapView
                ref={mapRef}
                style={styles.maps}
                initialRegion={INITIAL_MAP_REGION}
                // provider="google"
                customMapStyle={dark ? googleMapsStyling.dark : googleMapsStyling.light}
                onTouchEnd={onMapRegionChange}
                showsUserLocation={offRoad}
                followsUserLocation={isRecentered}
            >
                {nearestPointOnPolylineAnimated && (
                    <Marker.Animated
                        ref={currentLocationMarkerRef}
                        coordinate={nearestPointOnPolylineAnimated}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.currentLocationMarker} />
                    </Marker.Animated>
                )}

                {Object.keys(polylines).map((key) => (
                    <>
                        <Marker
                            key={`marker_start_${polylines[key].polyline[0]}`}
                            coordinate={polylines[key].polyline[0]}
                            anchor={{ x: 0.5, y: 0.5 }}
                        >
                            <View
                                key={`marker_start_view_${polylines[key].polyline[0]}`}
                                style={{
                                    ...styles.marker,
                                    backgroundColor: colors.white,
                                    borderColor: colors.middle_grey,
                                }}
                            />
                        </Marker>
                        <Polyline
                            key={`polyline_outer_${polylines[key].polyline[0]}`}
                            coordinates={polylines[key].polyline}
                            strokeWidth={14}
                            zIndex={-1}
                            strokeColor={pSBC(
                                -0.5,
                                polylines[key].color
                                    ? polylines[key].color
                                    : colors.upper_background,
                            )}
                        />
                        <Polyline
                            key={`polyline_inner_${polylines[key].polyline[0]}`}
                            coordinates={polylines[key].polyline}
                            strokeWidth={8}
                            zIndex={0}
                            strokeColor={polylines[key].color}
                        />
                        <Marker
                            key={`marker_end_${
                                polylines[key].polyline[polylines[key].polyline.length - 1]
                            }`}
                            coordinate={polylines[key].polyline[polylines[key].polyline.length - 1]}
                            anchor={{ x: 0.5, y: 0.5 }}
                        >
                            <View
                                key={`marker_end_view_${
                                    polylines[key].polyline[polylines[key].polyline.length - 1]
                                }`}
                                style={{
                                    ...styles.marker,
                                    backgroundColor: colors.white,
                                    borderColor: colors.middle_grey,
                                }}
                            />
                        </Marker>
                    </>
                ))}

                <Polyline
                    zIndex={10}
                    coordinates={passedPolylines}
                    strokeWidth={14}
                    strokeColor={pSBC(-0.5, colors.middle_grey)}
                />
                <Polyline
                    zIndex={11}
                    coordinates={passedPolylines}
                    strokeWidth={8}
                    strokeColor={colors.middle_grey}
                />
            </MapView>

            <TopNavigationPanel />
            {navigationDone && <BottomDoneNavigationPanel />}
            {!navigationDone && <BottomNavigationPanel />}
        </View>
    );
};

export default Navigation;
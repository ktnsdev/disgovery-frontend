import {
    StyleSheet,
    View,
    TouchableWithoutFeedback,
    TouchableOpacity,
    Dimensions,
} from "react-native";
import React, { useRef, useEffect, useState } from "react";
import ThemedText from "../../components/themed-text";
import { useNavigation, useTheme } from "@react-navigation/native";
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
    snapToPolyline,
} from "./util";
import Animated, {
    Easing,
    runOnJS,
    runOnUI,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import RecenterButton from "../../components/recenter-button";
import ExpandDownIcon18px from "../../assets/svgs/expand-down-icon-18px";
import SvgAnimatedLinearGradient from "react-native-svg-animated-linear-gradient/src";
import { sendNotification } from "../../functions/notification";
import ThemedTextMarquee from "../../components/themed-text-marquee";
import Svg, { Polygon } from "react-native-svg";
import NavigationCautionModal from "./components/caution-modal";

const CHECKPOINT_SNAP_DISTANCE = 0.1;

const INITIAL_MAP_REGION = {
    latitude: 13.764889,
    longitude: 100.538266,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;

const BOTTOM_NAVIGATION_PANEL_MENU_HEIGHT = 67;
const BOTTOM_NAVIGATION_PADDING_BOTTOM_EXPANDED = 8;
const BOTTOM_NAVIGATION_PADDING_BOTTOM_COLLAPSED = 18;
const TOP_NAVIGATION_PANEL_HEIGHT = 0.4 * SCREEN_HEIGHT;
const TOP_NAVIGATION_PANEL_WIDTH = SCREEN_WIDTH;

const ARROW_INDEX_BETWEEN = 1;
const POLYLINE_SIZE_OUTER = 14;
const POLYLINE_SIZE_INNER = 8;
const POLYLINE_WALK_SIZE_OUTER = 14;
const POLYLINE_WALK_SIZE_INNER = 8;
const POLYLINE_WALK_LINE_DASH_PHASE = undefined;

const SHOULD_SHOW_CAUTION_MODAL_ON_START = true;
const CAUTION_MODAL_ANIMATION_TIMING = 200;

let foregroundSubscription = null;
let foregroundHeadingSubscription = null;

function Navigation(props) {
    const { colors, dark } = useTheme();
    const ROUTE_DETAILS = props.route.params.route_data;
    const navigation = useNavigation();

    let firstRun = true;
    let firstRecentered = false;

    const mapRef = useRef(null);
    const currentLocationMarkerRef = useRef(null);
    const SAFE_AREA = useSafeAreaInsets();

    const [isRecentered, setIsRecentered] = useState(true);

    const [location, setLocation] = useState(undefined);
    const [mapsCurrentLocationRegion, setMapCurrentLocationRegion] = useState(undefined);
    const [locationErrorMessage, setLocationErrorMessage] = useState(null);
    const [polylines, setPolylines] = useState([]);
    const [passedPolylines, setPassedPolylines] = useState([]);
    const [arrowPolylineBottom, setArrowPolylineBottom] = useState({});
    const [arrowPolylineTop, setArrowPolylineTop] = useState({});
    const [arrowHeadRotation, setArrowHeadRotation] = useState(0.0);
    const [cameraHeading, setCameraHeading] = useState(0.0);
    const [directions, setDirections] = useState([]);
    const [currentDirection, setCurrentDirection] = useState(undefined);
    const [nextDirection, setNextDirection] = useState(undefined);
    const [nearestPointOnPolyline, setNearestPointOnPolyline] = useState(undefined);
    const [nearestPointOnPolylineAnimated, setNearestPointOnPolylineAnimated] = useState(undefined);
    const [offRoad, setOffRoad] = useState(false);
    const [navigationDone, setNavigationDone] = useState(false);
    const [heading, setHeading] = useState(undefined);

    const [ETAs, setETAs] = useState([]);
    const [currentETA, setCurrentETA] = useState(0);

    const [bottomNavigationPanelViewWidth, setBottomNavigationPanelViewWidth] = useState(0);
    const [bottomNavigationPanelMenuIsExpanded, setBottomNavigationPanelMenuIsExpanded] =
        useState(false);
    const [topNavigationPanelIsExpanded, setTopNavigationPanelIsExpanded] = useState(false);
    const [showCautionModal, setShowCautionModal] = useState(SHOULD_SHOW_CAUTION_MODAL_ON_START);

    const [spoken, setSpoken] = useState([]);
    const [speechVoices, setSpeechVoices] = useState([]);
    const [selectedSpeechVoice, setSelectedSpeechVoice] = useState({ language: "en-GB" });

    const doneSubviewWidthReanimated = useSharedValue(0);
    const expandBottomNavigationPanelMenuIconRotation = useSharedValue("0deg");
    const bottomNavigationPanelMenuPaddingBottomReanimated = useSharedValue(
        BOTTOM_NAVIGATION_PADDING_BOTTOM_COLLAPSED,
    );
    const bottomNavigationPanelMenuHeightReanimated = useSharedValue(0);
    const bottomNavigationPanelMenuDividerOpacityReanimated = useSharedValue(0);
    let topNavigationPanelHeight = 0;
    let topNavigationPanelWidth = 0;
    const topNavigationPanelHeightReanimated = useSharedValue(0);
    const topNavigationPanelWidthReanimated = useSharedValue(0);
    const cautionModalOpacityReanimated = useSharedValue(0);

    useEffect(() => {
        if (firstRun) {
            (async () => {
                if (showCautionModal) {
                    cautionModalOpacityReanimated.value = 1;
                }

                await parsePolylines();
                await fallbackFetchNewLocation();
                await fetchNewLocation();
                setSpeechVoices(await Speech.getAvailableVoicesAsync());
            })().catch(() => {});

            setBottomNavigationPanelMenuIsExpanded(true);
            setBottomNavigationPanelMenuIsExpanded(false);
            firstRun = false;
        }
    }, []);

    useEffect(() => {
        if (polylines.length !== 0) {
            parseDirections();
        }
    }, [polylines]);

    useEffect(() => {
        setSelectedSpeechVoice(speechVoices.find((voice) => voice.language === "en-US"));
    }, [speechVoices]);

    useEffect(() => {
        determineNavigationDone();
        determineArrowPolylines();
    }, [currentDirection]);

    // useEffect(() => {
    //     let subscribed = true;

    //     if (subscribed) {
    //         if (isRecentered) {
    //             mapRef.current.animateToRegion(mapsCurrentLocationRegion, 50);
    //         }
    //     }

    //     return () => {
    //         subscribed = false;
    //     };
    // }, [mapsCurrentLocationRegion]);

    useEffect(async () => {
        let subscribed = true;

        if (subscribed) {
            if (polylines.length === 0) {
                await parsePolylines();
            }

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

                        if (!offRoad && snapped.offRoad) {
                            // Speech.speak("You are off the road.", selectedSpeechVoice);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        }

                        determineCurrentDirection();
                        determineCurrentETA();
                    }
                }
            }
        }
        return () => {
            subscribed = false;
        };
    }, [location]);

    async function fallbackFetchNewLocation() {
        Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
        })
            .then((location) => {
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

                recenter({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                });

                firstRecentered = true;
            })
            .catch(() => {});
    }

    async function fetchNewLocation() {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
            setLocationErrorMessage("Permission to access location was denied");
            return;
        }

        foregroundSubscription?.remove();
        foregroundSubscription = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 100,
                distanceInterval: 0,
            },
            (location) => {
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

                if (!firstRecentered) {
                    recenter({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.005,
                        longitudeDelta: 0.005,
                    });

                    firstRecentered = true;
                }
            },
        );

        foregroundHeadingSubscription?.remove();
        foregroundHeadingSubscription = await Location.watchHeadingAsync((h) => {
            setHeading(h.trueHeading);
        });
    }

    async function recenter(region) {
        setIsRecentered(true);
        mapRef.current.animateToRegion(region || INITIAL_MAP_REGION);
        // mapRef.current.animateToViewingAngle(heading || 0, 300);
        // mapRef.current.animateCamera(
        //     {
        //         center: {
        //             latitude: location.latitude,
        //             longitude: location.longitude,
        //         },
        //         pitch: 2,
        //         heading: heading,
        //         zoom: mapsCurrentLocationRegion.latitudeDelta,
        //         altitude: 1 / mapsCurrentLocationRegion.latitudeDelta,
        //     },
        //     300,
        // );
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
                setNextDirection(directions[parseInt(nearestKey) + 1]);
                if (directions[nearestKey].text) {
                    speakDirectionWithHaptics(directions, nearestKey);
                    sendNotification(
                        directions[nearestKey].subtext || undefined,
                        directions[nearestKey].text,
                        1,
                    );
                }
                return;
            }

            if (nearestDistance <= CHECKPOINT_SNAP_DISTANCE) {
                if (
                    currentDirection.near.lat !== directions[nearestKey].near.lat &&
                    currentDirection.near.lng !== directions[nearestKey].near.lng
                ) {
                    setCurrentDirection(directions[nearestKey]);
                    setNextDirection(directions[parseInt(nearestKey) + 1]);
                    if (directions[nearestKey].text) {
                        speakDirectionWithHaptics(directions, nearestKey);
                        sendNotification(
                            directions[nearestKey].subtext || undefined,
                            directions[nearestKey].text,
                            1,
                        );
                    }
                }
            }
        }
    }

    function speakDirectionWithHaptics(directions, nearestKey) {
        let tempSpoken = [...spoken];
        let hapticPlayed = false;

        if (directions[nearestKey].text && !spoken.includes(directions[nearestKey].text)) {
            Speech.speak(directions[nearestKey].text.replace(":", ","), selectedSpeechVoice);
            tempSpoken.push(directions[nearestKey].text);

            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            hapticPlayed = true;
        }

        if (directions[nearestKey].subtext && !spoken.includes(directions[nearestKey].subtext)) {
            Speech.speak(
                `${
                    parseInt(nearestKey) !== 0
                        ? directions[parseInt(nearestKey) - 1].subtext
                            ? `This is ${directions[parseInt(nearestKey) - 1].subtext.replace(
                                  "Next: ",
                                  "",
                              )}.`
                            : ""
                        : ""
                } The next station is ${
                    directions[nearestKey].subtext
                        ? directions[nearestKey].subtext.replace("Next: ", "")
                        : ""
                }`,
                selectedSpeechVoice,
            );
            tempSpoken.push(directions[nearestKey].subtext);

            if (!hapticPlayed) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                hapticPlayed = true;
            }
        }

        setSpoken([...tempSpoken]);
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
                    break;
                } else {
                    tempETAs[i].current_eta = 0;
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
            } else if (direction.type === "transfer") {
                if (direction.encoded_polyline) {
                    tempPolylines.push({
                        route_id: `transfer_from_${direction.from.coordinates.lat}_${direction.from.coordinates.lng}_to_${direction.to.coordinates.lat}_${direction.to.coordinates.lng}`,
                        polyline: decodePolyline(direction.encoded_polyline),
                        color: colors.go_button,
                    });
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
                        route_id: `walk_from_${ROUTE_DETAILS.directions[i].from.coordinates.lat}_${ROUTE_DETAILS.directions[i].from.coordinates.lng}_to_${ROUTE_DETAILS.directions[i].to.coordinates.lat}_${ROUTE_DETAILS.directions[i].to.coordinates.lng}`,
                        text: htmlToText(step.html_instructions),
                        near: step.start_location,
                        arrive: false,
                    });
                }

                let currentPolyline = polylines.find(
                    (p) =>
                        p.route_id ===
                        `walk_from_${ROUTE_DETAILS.directions[i].from.coordinates.lat}_${ROUTE_DETAILS.directions[i].from.coordinates.lng}_to_${ROUTE_DETAILS.directions[i].to.coordinates.lat}_${ROUTE_DETAILS.directions[i].to.coordinates.lng}`,
                );

                tempETAs.push({
                    route_id: `walk_from_${ROUTE_DETAILS.directions[i].from.coordinates.lat}_${ROUTE_DETAILS.directions[i].from.coordinates.lng}_to_${ROUTE_DETAILS.directions[i].to.coordinates.lat}_${ROUTE_DETAILS.directions[i].to.coordinates.lng}`,
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
                    route_id: `transfer_from_${ROUTE_DETAILS.directions[i].from.coordinates.lat}_${ROUTE_DETAILS.directions[i].from.coordinates.lng}_to_${ROUTE_DETAILS.directions[i].to.coordinates.lat}_${ROUTE_DETAILS.directions[i].to.coordinates.lng}`,
                    eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    current_eta: ROUTE_DETAILS.directions[i].schedule.duration,
                    distance: getTotalDistanceOfRoute(ROUTE_DETAILS.directions[i].encoded_polyline),
                });
            }

            if (parseInt(i) === ROUTE_DETAILS.directions.length - 1) {
                if (ROUTE_DETAILS.directions[i].type === "walk") {
                    tempDirections.push({
                        text: `You have arrived at ${ROUTE_DETAILS.directions[i].to.place.address}`,
                        route_id: `walk_from_${ROUTE_DETAILS.directions[i].from.coordinates.lat}_${ROUTE_DETAILS.directions[i].from.coordinates.lng}_to_${ROUTE_DETAILS.directions[i].to.coordinates.lat}_${ROUTE_DETAILS.directions[i].to.coordinates.lng}`,
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
            setNavigationDone(true);
            runOnUI(() => {
                "worklet";
                doneSubviewWidthReanimated.value = bottomNavigationPanelViewWidth - 20;
            })();
        }
    }

    function determineArrowPolylines() {
        if (!currentDirection) {
            setArrowPolylineBottom({});
            setArrowPolylineTop({});
            return;
        }

        if (currentDirection.route_id && currentDirection.route_id.startsWith("walk")) {
            let currentPolyline = polylines.find((p) => {
                return p.route_id === currentDirection.route_id;
            });

            let index = 0;
            let nearestDistance = Number.MAX_SAFE_INTEGER;

            for (let i in currentPolyline.polyline) {
                let distance = getDistanceFromLatLonInKm(
                    currentPolyline.polyline[i].latitude,
                    currentPolyline.polyline[i].longitude,
                    currentDirection.near.lat,
                    currentDirection.near.lng,
                );
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    index = parseInt(i);
                }
            }

            let startingIndex = index - ARROW_INDEX_BETWEEN < 0 ? 0 : index - ARROW_INDEX_BETWEEN;
            let endingIndex =
                index + ARROW_INDEX_BETWEEN > currentPolyline.polyline.length - 1
                    ? currentPolyline.polyline.length - 1
                    : index + ARROW_INDEX_BETWEEN;

            let tempArrowPolylineBottom = [];
            for (let i = startingIndex; i <= endingIndex; i++) {
                tempArrowPolylineBottom.push(currentPolyline.polyline[i]);
            }

            let tempArrowHeadRotation = 0.0;

            if (tempArrowPolylineBottom.length >= 2) {
                tempArrowHeadRotation = angleBetweenCoordinatesInDegrees(
                    tempArrowPolylineBottom[tempArrowPolylineBottom.length - 1].latitude,
                    tempArrowPolylineBottom[tempArrowPolylineBottom.length - 1].longitude,
                    tempArrowPolylineBottom[tempArrowPolylineBottom.length - 2].latitude,
                    tempArrowPolylineBottom[tempArrowPolylineBottom.length - 2].longitude,
                );
            }

            setArrowHeadRotation(tempArrowHeadRotation);
            setArrowPolylineBottom({
                route_id: `${currentDirection.route_id}_arrow`,
                polyline: tempArrowPolylineBottom,
                color: colors.white,
            });
        } else {
            setArrowPolylineBottom({});
            setArrowPolylineTop({});
        }
    }

    function onCautionModalDismiss() {
        cautionModalOpacityReanimated.value = 0;
        setTimeout(() => setShowCautionModal(false), CAUTION_MODAL_ANIMATION_TIMING);
    }

    function angleBetweenCoordinatesInDegrees(cx, cy, ex, ey) {
        var dy = ey - cy;
        var dx = ex - cx;
        var theta = Math.atan2(dy, dx);
        theta *= 180 / Math.PI;
        return theta;
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

    function onExitNavigation() {
        navigation.goBack();
    }

    function onRecenterButtonPress() {
        recenter({
            ...location,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
        });
        setIsRecentered(true);
    }

    function onExpandBottomNavigationPanelMenuPress() {
        "worklet";

        // if (!currentDirection) return;

        if (!bottomNavigationPanelMenuIsExpanded) {
            bottomNavigationPanelMenuHeightReanimated.value = BOTTOM_NAVIGATION_PANEL_MENU_HEIGHT;
            bottomNavigationPanelMenuDividerOpacityReanimated.value = 1;
            bottomNavigationPanelMenuPaddingBottomReanimated.value =
                BOTTOM_NAVIGATION_PADDING_BOTTOM_EXPANDED;
            expandBottomNavigationPanelMenuIconRotation.value = "180deg";
        } else {
            bottomNavigationPanelMenuHeightReanimated.value = 0;
            bottomNavigationPanelMenuDividerOpacityReanimated.value = 0;
            bottomNavigationPanelMenuPaddingBottomReanimated.value =
                BOTTOM_NAVIGATION_PADDING_BOTTOM_COLLAPSED;
            expandBottomNavigationPanelMenuIconRotation.value = "0deg";
        }

        runOnJS(() => {
            setBottomNavigationPanelMenuIsExpanded(!bottomNavigationPanelMenuIsExpanded);
        })();
    }

    function onExpandTopNavigationPanelPress() {
        "worklet";
        if (!topNavigationPanelIsExpanded) {
            topNavigationPanelHeightReanimated.value = TOP_NAVIGATION_PANEL_HEIGHT;
            topNavigationPanelWidthReanimated.value = TOP_NAVIGATION_PANEL_WIDTH;
        } else {
            topNavigationPanelHeightReanimated.value = topNavigationPanelHeight;
            topNavigationPanelWidthReanimated.value = topNavigationPanelWidth;
        }

        runOnJS(() => {
            setTopNavigationPanelIsExpanded(!topNavigationPanelIsExpanded);
        })();
    }

    function onTopNavigationPanelLayoutChange(event) {
        if (!topNavigationPanelIsExpanded) {
            if (event.nativeEvent.height !== topNavigationPanelHeightReanimated.value) {
                topNavigationPanelHeight = event.nativeEvent.height;
            }

            if (event.nativeEvent.width !== topNavigationPanelWidthReanimated.value) {
                topNavigationPanelWidth = event.nativeEvent.width;
            }
        }
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
            overflow: "hidden",
        },
        bottomNavigationPanelTitle: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        bottomNaviationPanelTitleArrowIcon: {
            marginHorizontal: 5,
        },
        onGoingNavigationText: {
            color: colors.subtitle,
            fontSize: 16,
        },
        destinationText: {
            fontSize: 16,
            color: colors.subtitle,
            fontWeight: "600",
        },
        bottomNavigationPanelArrivingInContainer: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            marginTop: 5,
            zIndex: 50,
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
        bottomNavigationPanelFromToContainer: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            flex: 1,
        },
        bottomNavigationExpandUpIconContainer: {
            alignSelf: "flex-end",
            marginRight: 0,
            marginLeft: "auto",
            width: 30,
            height: 20,
            zIndex: 1,
        },
        bottomNavigationExpandUpIconSubContainer: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "flex-end",
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
            position: "absolute",
            alignSelf: "flex-start",
            height: "100%",
            backgroundColor: colors.linear_gradient_primary,

            shadowColor: colors.shadow,
            shadowOffset: {
                width: 0,
                height: 5,
            },
            shadowOpacity: 0.34,
            shadowRadius: 6.27,

            elevation: 10,
        },
        divider: {
            height: 1,
            marginTop: 18,
            backgroundColor: colors.divider,
        },
        exitNavigationText: {
            color: colors.red,
            fontWeight: "600",
            fontSize: 18,
        },
        bottomNavigationPanelMenuItemContainer: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 48,
        },
        bottomNavigationPanelToTextContainer: {
            flex: 1,
            // marginLeft: 3,
        },
    });

    const animatedBottomNavigationPanelMenuHeight = useAnimatedStyle(() => {
        return {
            height: withTiming(bottomNavigationPanelMenuHeightReanimated.value, {
                duration: 100,
                easing: Easing.ease,
            }),
        };
    });

    const animatedBottomNavigationPanelMenuDividerOpacity = useAnimatedStyle(() => {
        return {
            opacity: withTiming(bottomNavigationPanelMenuDividerOpacityReanimated.value, {
                duration: 100,
                easing: Easing.ease,
            }),
        };
    });

    const animatedBottomNavigationPanelMenuPaddingBottom = useAnimatedStyle(() => {
        return {
            paddingBottom: withTiming(bottomNavigationPanelMenuPaddingBottomReanimated.value, {
                duration: 100,
                easing: Easing.ease,
            }),
        };
    });

    const animatedDoneSubviewWidth = useAnimatedStyle(() => {
        return {
            width: withTiming(
                doneSubviewWidthReanimated.value,
                {
                    duration: 4000,
                    easing: Easing.inOut(Easing.linear),
                },
                (finished) => {
                    "worklet";
                    if (finished && doneSubviewWidthReanimated.value != 0) {
                        runOnJS(onExitNavigation)();
                    }
                },
            ),
        };
    });

    const animatedExpandBottomNavigationPanelMenuIconRotation = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    rotate: withTiming(expandBottomNavigationPanelMenuIconRotation.value, {
                        duration: 100,
                        easing: Easing.ease,
                    }),
                },
            ],
        };
    });

    const animatedTopNavigationPanelWidthHeight = useAnimatedStyle(() => {
        return {
            height: withTiming(topNavigationPanelHeightReanimated.value, {
                duration: 200,
                easing: Easing.ease,
            }),
            width: withTiming(topNavigationPanelWidthReanimated.value, {
                duration: 200,
                easing: Easing.ease,
            }),
        };
    });

    const animatedCautionModalOpacity = useAnimatedStyle(() => {
        return {
            opacity: withTiming(cautionModalOpacityReanimated.value, {
                duration: CAUTION_MODAL_ANIMATION_TIMING,
                easing: Easing.ease,
            }),
        };
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
                    style={[styles.bottomDoneSubview, animatedDoneSubviewWidth]}
                ></Animated.View>
                <ThemedText style={styles.doneText}>Done</ThemedText>
            </View>
        </View>
    );

    const TopNavigationPanel = () => (
        <>
            <View style={styles.topNavigationPanelContainerWithSafeAreaContainer}>
                {/* <TouchableWithoutFeedback onPress={onExpandTopNavigationPanelPress}> */}
                <Animated.View
                    style={[
                        styles.topNavigationPanelContainer,
                        // topNavigationPanelHeight === 0 && topNavigationPanelWidth === 0
                        //     ? {}
                        //     : animatedTopNavigationPanelWidthHeight,
                    ]}
                >
                    {/* <View onLayout={onTopNavigationPanelLayoutChange}> */}
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
                                primaryColor={colors.linear_gradient_primary}
                                secondaryColor={colors.linear_gradient_secondary}
                            />
                            <SvgAnimatedLinearGradient
                                style={{ marginTop: 5 }}
                                width="50%"
                                height={16}
                                primaryColor={colors.linear_gradient_primary}
                                secondaryColor={colors.linear_gradient_secondary}
                            />
                        </>
                    )}
                    {/* </View> */}
                </Animated.View>
                {/* </TouchableWithoutFeedback> */}

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
            onLayout={(event) => {
                setBottomNavigationPanelViewWidth(event.nativeEvent.layout.width);
            }}
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

            <TouchableWithoutFeedback onPressIn={onExpandBottomNavigationPanelMenuPress}>
                <Animated.View
                    style={[
                        styles.bottomNavigationPanelContainer,
                        animatedBottomNavigationPanelMenuPaddingBottom,
                    ]}
                >
                    {currentDirection && (
                        <>
                            <View style={styles.bottomNavigationPanelTitle}>
                                <View style={styles.bottomNavigationPanelFromToContainer}>
                                    <ThemedText style={styles.onGoingNavigationText}>
                                        On-going navigation
                                    </ThemedText>
                                    <ArrowIcon style={styles.bottomNaviationPanelTitleArrowIcon} />
                                    <View style={styles.bottomNavigationPanelToTextContainer}>
                                        <ThemedTextMarquee style={styles.destinationText}>
                                            {props.route.params.destination_name
                                                ? props.route.params.destination_name
                                                : `${ROUTE_DETAILS.destination.coordinates.lat}, ${ROUTE_DETAILS.destination.coordinates.lng}`}
                                        </ThemedTextMarquee>
                                    </View>
                                </View>
                                <TouchableWithoutFeedback
                                    style={styles.bottomNavigationExpandUpIconContainer}
                                    onPressIn={onExpandBottomNavigationPanelMenuPress}
                                >
                                    <Animated.View
                                        style={[
                                            styles.bottomNavigationExpandUpIconSubContainer,
                                            animatedExpandBottomNavigationPanelMenuIconRotation,
                                        ]}
                                    >
                                        <ExpandDownIcon18px />
                                    </Animated.View>
                                </TouchableWithoutFeedback>
                            </View>
                            <View style={styles.bottomNavigationPanelArrivingInContainer}>
                                <ThemedText style={styles.bottomNavigationPanelArrivingInText}>
                                    Arriving in
                                </ThemedText>
                                <ThemedText style={styles.bottomNavigationPanelTimeText}>
                                    {Math.round(currentETA / 60)} min
                                </ThemedText>
                                <ThemedText style={styles.bottomNavigationPanelETAText}>
                                    ?? {dayjs().add(currentETA, "second").format("HH:mm")}
                                </ThemedText>
                            </View>
                            <Animated.View style={[animatedBottomNavigationPanelMenuHeight]}>
                                <BottomNavigationPanelMenu />
                            </Animated.View>
                        </>
                    )}

                    {!currentDirection && (
                        <>
                            <View style={{ flex: 1 }}>
                                <SvgAnimatedLinearGradient
                                    width="80%"
                                    height={16}
                                    primaryColor={colors.linear_gradient_primary}
                                    secondaryColor={colors.linear_gradient_secondary}
                                />
                                <SvgAnimatedLinearGradient
                                    style={{ marginTop: 5 }}
                                    width="90%"
                                    height={27}
                                    primaryColor={colors.linear_gradient_primary}
                                    secondaryColor={colors.linear_gradient_secondary}
                                />
                            </View>

                            <Animated.View style={[animatedBottomNavigationPanelMenuHeight]}>
                                <BottomNavigationPanelMenu />
                            </Animated.View>
                        </>
                    )}
                </Animated.View>
            </TouchableWithoutFeedback>
        </View>
    );

    const BottomNavigationPanelMenu = () => (
        <>
            <View>
                <Animated.View
                    style={[styles.divider, animatedBottomNavigationPanelMenuDividerOpacity]}
                />
                <TouchableOpacity
                    style={styles.bottomNavigationPanelMenuItemContainer}
                    onPressIn={onExitNavigation}
                >
                    <ThemedText style={styles.exitNavigationText}>Exit navigation</ThemedText>
                </TouchableOpacity>
            </View>
        </>
    );

    return (
        <>
            <View style={styles.container}>
                <MapView
                    ref={mapRef}
                    style={styles.maps}
                    initialRegion={INITIAL_MAP_REGION}
                    // provider="google"
                    customMapStyle={dark ? googleMapsStyling.dark : googleMapsStyling.light}
                    onPanDrag={onMapRegionChange}
                    showsMyLocationButton={false}
                    showsUserLocation={true}
                    followsUserLocation={isRecentered}
                >
                    {/* {nearestPointOnPolylineAnimated && !offRoad && (
                        <Marker.Animated
                            ref={currentLocationMarkerRef}
                            coordinate={nearestPointOnPolylineAnimated}
                            anchor={{ x: 0.5, y: 0.5 }}
                        >
                            <View style={styles.currentLocationMarker} />
                        </Marker.Animated>
                    )} */}

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
                                strokeWidth={
                                    polylines[key].route_id.startsWith("walk")
                                        ? POLYLINE_WALK_SIZE_OUTER
                                        : POLYLINE_SIZE_OUTER
                                }
                                zIndex={-1}
                                lineDashPattern={
                                    polylines[key].route_id.startsWith("walk")
                                        ? POLYLINE_WALK_LINE_DASH_PHASE
                                        : undefined
                                }
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
                                strokeWidth={
                                    polylines[key].route_id.startsWith("walk")
                                        ? POLYLINE_WALK_SIZE_INNER
                                        : POLYLINE_SIZE_INNER
                                }
                                zIndex={0}
                                lineDashPattern={
                                    polylines[key].route_id.startsWith("walk")
                                        ? POLYLINE_WALK_LINE_DASH_PHASE
                                        : undefined
                                }
                                strokeColor={polylines[key].color}
                            />

                            {arrowPolylineBottom && (
                                <>
                                    <Polyline
                                        key={`polyline_outer_${arrowPolylineBottom.route_id}`}
                                        coordinates={arrowPolylineBottom.polyline}
                                        strokeWidth={POLYLINE_SIZE_OUTER}
                                        zIndex={10}
                                        strokeColor={pSBC(
                                            -0.5,
                                            arrowPolylineBottom.color
                                                ? arrowPolylineBottom.color
                                                : colors.upper_background,
                                        )}
                                        lineCap="butt"
                                    />

                                    <Polyline
                                        key={`polyline_inner_${arrowPolylineBottom.route_id}`}
                                        coordinates={arrowPolylineBottom.polyline}
                                        strokeWidth={POLYLINE_SIZE_INNER}
                                        zIndex={11}
                                        strokeColor={arrowPolylineBottom.color}
                                        lineCap="butt"
                                    />
                                </>
                            )}

                            {arrowPolylineTop && (
                                <>
                                    <Polyline
                                        key={`polyline_outer_${arrowPolylineTop.route_id}`}
                                        coordinates={arrowPolylineTop.polyline}
                                        strokeWidth={14}
                                        zIndex={3}
                                        strokeColor={pSBC(
                                            -0.5,
                                            arrowPolylineTop.color
                                                ? arrowPolylineTop.color
                                                : colors.upper_background,
                                        )}
                                        lineCap="butt"
                                    />

                                    <Polyline
                                        key={`polyline_inner_${arrowPolylineTop.route_id}`}
                                        coordinates={arrowPolylineTop.polyline}
                                        strokeWidth={8}
                                        zIndex={2}
                                        strokeColor={arrowPolylineTop.color}
                                        lineCap="butt"
                                    />
                                </>
                            )}

                            {/* {arrowPolylineBottom && (
                            <>
                                <Marker
                                    style={{ transform: [{ rotate: `${arrowHeadRotation}deg` }] }}
                                    coordinate={
                                        arrowPolylineBottom.polyline
                                            ? arrowPolylineBottom.polyline[
                                                  arrowPolylineBottom.polyline.length - 1
                                              ]
                                            : null
                                    }
                                    zIndex={8}
                                    anchor={{ x: 1, y: 0.5 }}
                                >
                                    <Svg height={18} width={18}>
                                        <Polygon
                                            points="0,18 9,0 18,18"
                                            fill={colors.white}
                                            stroke={pSBC(-0.5, colors.white)}
                                            strokeWidth={POLYLINE_SIZE_OUTER - POLYLINE_SIZE_INNER}
                                        />
                                    </Svg>
                                </Marker>
                            </>
                        )} */}

                            <Marker
                                key={`marker_end_${
                                    polylines[key].polyline[polylines[key].polyline.length - 1]
                                }`}
                                coordinate={
                                    polylines[key].polyline[polylines[key].polyline.length - 1]
                                }
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
                {!navigationDone && <BottomNavigationPanel />}
                {navigationDone && <BottomDoneNavigationPanel />}
                {showCautionModal && (
                    <Animated.View
                        style={[
                            {
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: "100%",
                            },
                            animatedCautionModalOpacity,
                        ]}
                    >
                        <NavigationCautionModal onDismiss={onCautionModalDismiss} />
                    </Animated.View>
                )}
            </View>
        </>
    );
}

export default Navigation;

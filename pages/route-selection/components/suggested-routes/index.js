import React from "react";
import ThemedText from "../../../../components/themed-text";
import { View, StyleSheet } from "react-native";
import CloudOffIcon from "../../../../assets/svgs/cloud-off";
import RoutesDetailedBlock from "../routes-detailed-block";

export default function SuggestedRoutes(props) {
    const HasMostComfy = false;
    const styles = StyleSheet.create({
        container: {
            paddingHorizontal: props.containerPadding,
        },
        titleText: {
            fontWeight: "bold",
            fontSize: 24,
            padding: 12,
        },
        subContainer: {
            justifyContent: "center",
            alignItems: "center",
            paddingVertical: 6,
        },
    });
    return (
        <>
            <View style={styles.container}>
                <ThemedText style={props.topictextStyle}>Suggested routes</ThemedText>

                {props.data.map((item, key) => (
                    <View style={styles.subContainer}>
                        <RoutesDetailedBlock
                            key={key}
                            routeData={item}
                            onPress={() => {
                                props.setSelectData(item);
                                props.onPress();
                            }}
                        />
                    </View>
                ))}

                {HasMostComfy && (
                    <>
                        <ThemedText style={props.topictextStyle}>Most comfortable</ThemedText>
                        <View style={styles.subContainer}>
                            <RoutesDetailedBlock />
                        </View>
                    </>
                )}
            </View>
        </>
    );
}

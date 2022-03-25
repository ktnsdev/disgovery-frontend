import React from "react";
import ThemedText from "../../../../components/themed-text";
import { View, StyleSheet } from "react-native";
import CloudOffIcon from "../../../../assets/svgs/cloud-off";

export default function OverViewRoute(props) {
    const styles = StyleSheet.create({
        container: {
            width: "100%",
            height: "100%",
            justifyContent: "center",
            alignItems: "center",
        },
        text: {
            fontWeight: "bold",
            fontSize: 24,
            padding: 12,
        },
    });
    return (
        <>
            <View style={styles.container}>
                <CloudOffIcon />
                <ThemedText style={styles.text}>No Connection</ThemedText>
            </View>
        </>
    );
}

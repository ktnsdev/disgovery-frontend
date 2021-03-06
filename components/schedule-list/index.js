import { StyleSheet, Text, View } from "react-native";
import React from "react";
import ThemedText from "../themed-text";
import { useTheme } from "@react-navigation/native";
import ThemedTextMarquee from "../themed-text-marquee";
import ArrowIcon24 from "../../assets/svgs/arrow-forward-24px";
import PropTypes from "prop-types";
import ArrowIcon from "../../assets/svgs/arrow-forward-18px";
import dayjs from "dayjs";

function ScheduleList(props) {
    const { colors } = useTheme();

    const styles = StyleSheet.create({
        container: {
            width: "100%",
            display: "flex",
            flexDirection: "row",
        },
        scheduleContainer: {
            flex: 1,
            width: "100%",
        },
        destination: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
        },
        destinationMarqueeContainer: {
            paddingLeft: 5,
            width: "100%",
        },
        destinationText: {
            fontSize: 20,
            fontWeight: "600",
        },
        scheduleFromText: {
            fontSize: 16,
            color: colors.subtitle,
            fontWeight: "500",
            marginLeft: 22,
        },
        scheduleText: {
            flex: 1,
            fontSize: 18,
            fontWeight: "500",
            width: "100%",
        },
        scheduleMarqueeContainer: {
            width: "100%",
        },
    });

    return (
        <View style={{ ...props.style, ...styles.container }}>
            <View style={styles.scheduler}>
                <View style={styles.destination}>
                    <ArrowIcon />
                    <View style={styles.destinationMarqueeContainer}>
                        <ThemedTextMarquee style={styles.destinationText}>
                            {props.destination}
                        </ThemedTextMarquee>
                    </View>
                </View>

                <View style={styles.scheduleContainer}>
                    {!!props.schedule && (
                        <>
                            <ThemedText style={styles.scheduleFromText}>from </ThemedText>
                            <View style={styles.scheduleMarqueeContainer}>
                                <ThemedTextMarquee style={styles.scheduleText}>
                                    {props.schedule}
                                </ThemedTextMarquee>
                            </View>
                        </>
                    )}

                    {!!props.subtitle && (
                        <>
                            <ThemedText style={styles.scheduleFromText}>
                                {props.subtitle}
                            </ThemedText>
                        </>
                    )}
                </View>
            </View>
        </View>
    );
}

ScheduleList.propTypes = {
    schedule: PropTypes.string,
    destination: PropTypes.string,
};

export default ScheduleList;

import { useTheme } from "@react-navigation/native";
import * as React from "react";
import Svg, { Path } from "react-native-svg";

const ArrowIcon24 = (props) => {
    const { colors } = useTheme();

    return (
        <Svg width={24} height={24} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <Path
                d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z"
                fill={props.fill || "#ACACAC"}
            />
        </Svg>
    );
};

export default ArrowIcon24;

import * as React from "react";
import Svg, { Path, Defs, Pattern, Use, Image } from "react-native-svg";
import { useTheme } from "@react-navigation/native";

const BusIcon = (props) => {
    const { colors } = useTheme();

    return (
        <Svg
            width={14}
            height={16}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            {...props}
        >
            <Path fill="url(#a)" d="M.131.965h13.636v14.727H.131z" />
            <Defs>
                <Pattern id="a" patternContentUnits="objectBoundingBox" width={1} height={1}>
                    <Use xlinkHref="#b" transform="matrix(.0021 0 0 .00195 -.04 0)" />
                </Pattern>
                <Image
                    id="b"
                    width={512}
                    height={512}
                    xlinkHref="data:image/png;base64,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"
                />
            </Defs>
        </Svg>
    );
};

export default BusIcon;
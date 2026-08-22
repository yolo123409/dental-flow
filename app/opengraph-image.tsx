import { ImageResponse } from "next/og";

export const alt = "Dental Flow - Dental Practice Management Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const EUCALYPTUS = "#216C68";
const DEEP_EUCALYPTUS = "#175552";
const PORCELAIN = "#F6F7F4";
const GRAPHITE = "#1D2B2A";
const SEA_GLASS = "#DCEAE6";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PORCELAIN,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "62%",
            height: "100%",
            background: `linear-gradient(135deg, ${EUCALYPTUS} 0%, ${DEEP_EUCALYPTUS} 100%)`,
            padding: "0 64px",
            color: "#FFFFFF",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginBottom: 18,
            }}
          >
            Dental Flow
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: 620,
            }}
          >
            Your entire dental practice. Connected.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              marginTop: 26,
              color: SEA_GLASS,
              maxWidth: 560,
            }}
          >
            Patients, appointments, billing, and charting - one platform.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "38%",
            height: "100%",
          }}
        >
          <svg width="220" height="260" viewBox="0 0 220 260" fill="none">
            <path
              d="M110 20C60 20 30 55 30 105c0 40 14 62 20 96 5 24 12 44 22 44 14 0 15-40 24-40s10 40 24 40c10 0 17-20 22-44 6-34 20-56 20-96C172 55 160 20 110 20Z"
              stroke={GRAPHITE}
              strokeWidth="3"
              opacity="0.18"
            />
          </svg>
        </div>
      </div>
    ),
    { ...size }
  );
}

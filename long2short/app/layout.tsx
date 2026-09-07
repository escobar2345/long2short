import React from "react";

export const metadata = {
  title: "Long2Short — AI clip editor",
  description: "Turn long-form videos into short-form clips with GLM + Remotion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0B0C0E", color: "#E8E6E1" }}>{children}</body>
    </html>
  );
}

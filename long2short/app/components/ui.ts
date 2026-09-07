// Shared styling constants for the multi-account UI components.
// Kept in sync with the original look in app/page.tsx (dark + orange accent).

import React from "react";

export const ACCENT = "#FF5A1F";
export const PANEL = "#15171A";
export const PANEL_LIGHT = "#1B1E22";
export const BORDER = "#2A2D31";
export const TEXT_MUTED = "#8A8D93";
export const GOOD = "#3ECF8E";
export const BAD = "#FF6B6B";

export const stepStyle: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: 24,
  marginBottom: 20,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: TEXT_MUTED,
  marginBottom: 8,
  display: "block",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0F1012",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: "10px 12px",
  color: "#E8E6E1",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const buttonStyle: React.CSSProperties = {
  background: ACCENT,
  color: "#0B0C0E",
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

export const buttonDisabled: React.CSSProperties = {
  ...buttonStyle,
  background: "#3A3D42",
  color: TEXT_MUTED,
  cursor: "not-allowed",
};

export const ghostButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#E8E6E1",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

export const cardStyle: React.CSSProperties = {
  background: PANEL_LIGHT,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: 14,
};
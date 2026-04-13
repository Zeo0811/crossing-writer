import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
function App() {
    return _jsx("div", { style: { padding: 24 }, children: "Crossing Writer \u2014 scaffolded." });
}
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));

import React, { ReactNode } from "react";
import { useSignalEffect } from "./utils.ts";

interface Props {
  children: ReactNode;
  onClose?: () => void;
}

export const Modal = ({ children, onClose }: Props) => {
  useSignalEffect((signal) => {
    const keyDown = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        onClose?.();
      }
    };
    document.body.addEventListener("keydown", keyDown, { signal });
  }, []);

  return (
    <div
      className="modal-container"
      onClick={(e) => {
        if (e.currentTarget === e.target) {
          onClose?.();
        }
      }}
    >
      {children}
    </div>
  );
};

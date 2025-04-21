import React, { useEffect, useRef } from "react";
import "./ContextMenu.css";

export interface ContextMenuOption {
  label: string;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  options: ContextMenuOption[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, options }) => {
  const onCloseRef = useRef<() => void>(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleClick = () => onCloseRef.current();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [onCloseRef]);

  return (
    <menu
      className="context-menu"
      style={{
        left: x,
        top: y,
      }}
    >
      {options.map((option, index) => (
        <button
          type="button"
          key={index}
          onClick={option.onClick}
        >
          {option.label}
        </button>
      ))}
    </menu>
  );
};

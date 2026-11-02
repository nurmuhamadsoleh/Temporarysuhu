"use client";
import { Modal } from "antd";

export function ResponsiveDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open
      title={title}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      footer={null}
      centered
      className="responsive-dialog"
      width={640}
    >
      {children}
    </Modal>
  );
}

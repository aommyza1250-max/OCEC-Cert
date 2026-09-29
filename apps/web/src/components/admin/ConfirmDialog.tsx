"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  tone?: "brand" | "danger";
};
export type ConfirmAction = (message: string, options?: ConfirmOptions) => Promise<boolean>;

type ConfirmRequest = {
  message: string;
  title: string;
  confirmLabel: string;
  tone: "brand" | "danger";
};

type Resolver = (confirmed: boolean) => void;

/** แทน browser confirm ด้วย dialog ของระบบ โดยผู้เรียกยังเลือกทำ action เดิมเมื่อยืนยันเท่านั้น */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setRequest({
        message,
        title: options.title ?? "ยืนยันการทำรายการ",
        confirmLabel: options.confirmLabel ?? "ยืนยัน",
        tone: options.tone ?? "brand",
      });
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  return {
    confirm: confirm as ConfirmAction,
    dialog: <ConfirmationDialog request={request} onResolve={settle} />,
  };
}

function ConfirmationDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest | null;
  onResolve: (confirmed: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-message`}
      onCancel={(event) => {
        event.preventDefault();
        onResolve(false);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-hairline bg-card p-0 text-ink shadow-2xl backdrop:bg-black/50"
    >
      {request && (
        <div className="p-5 sm:p-6">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            {request.title}
          </h2>
          <p id={`${id}-message`} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
            {request.message}
          </p>
          <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <button
              type="button"
              autoFocus
              onClick={() => onResolve(false)}
              className="min-h-11 cursor-pointer rounded-xl border border-hairline bg-card px-4 text-sm font-medium text-ink transition hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => onResolve(true)}
              className={`min-h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                request.tone === "danger" ? "bg-danger-ink" : "bg-brand"
              }`}
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Change password dialog module. */
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "../i18n/use-translation.js";
import { Button } from "./button.js";
import { Modal } from "./modal.js";

/** The values a cuberouter password change submits. */
export interface ChangePasswordInput {
  originalPassword: string;
  newPassword: string;
}

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: ChangePasswordInput) => Promise<void>;
  /** Called after the instance accepts the change, so the caller can close and confirm it. */
  onSuccess: () => void;
}

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Validates the form the way the instance will, so the user gets the answer without a round-trip.
 *
 * @returns The first problem, or null when the input can be submitted.
 */
export function validateChangePasswordInput(
  input: { originalPassword: string; newPassword: string; confirmPassword: string },
  t: Translate
): string | null {
  if (!input.originalPassword.trim()) {
    return t("settings.account.passwordRequired");
  }
  if (!input.newPassword) {
    return t("settings.account.newPasswordRequired");
  }
  if (input.newPassword.length < 8) {
    return t("settings.account.newPasswordTooShort");
  }
  if (input.newPassword.length > 20) {
    return t("settings.account.newPasswordTooLong");
  }
  // Mirrors the instance's passwordStrength rule: uppercase, lowercase and a digit.
  if (!/\p{Lu}/u.test(input.newPassword) || !/\p{Ll}/u.test(input.newPassword) || !/\p{Nd}/u.test(input.newPassword)) {
    return t("settings.account.newPasswordStrength");
  }
  if (input.newPassword === input.originalPassword) {
    return t("settings.account.newPasswordSame");
  }
  if (input.newPassword !== input.confirmPassword) {
    return t("settings.account.newPasswordMismatch");
  }
  return null;
}

/** A modal that changes the signed-in cuberouter account's password. */
export function ChangePasswordDialog(props: ChangePasswordDialogProps) {
  const { t } = useTranslation();
  const formId = useId();
  const currentPasswordRef = useRef<HTMLInputElement | null>(null);
  const [originalPassword, setOriginalPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateChangePasswordInput(
      { originalPassword, newPassword, confirmPassword },
      t
    );
    if (validation) {
      setError(validation);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ originalPassword, newPassword });
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : t("settings.account.changePasswordFailed")
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    props.onSuccess();
  }

  return (
    <Modal
      open={props.open}
      title={t("settings.account.changePasswordTitle")}
      closeDisabled={busy}
      closeLabel={t("common.close")}
      closeContent={<X size={16} aria-hidden="true" />}
      initialFocusRef={currentPasswordRef}
      onClose={busy ? undefined : props.onClose}
      footer={(
        <>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={props.onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button type="submit" form={formId} variant="primary" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden="true" />}
            {busy
              ? t("settings.account.changePasswordSubmitting")
              : t("settings.account.changePasswordSubmit")}
          </Button>
        </>
      )}
    >
      <form id={formId} className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <p className="text-xs text-text-ink/55 leading-relaxed">
          {t("settings.account.changePasswordDesc")}
        </p>
        <PasswordInput
          inputRef={currentPasswordRef}
          label={t("settings.account.currentPassword")}
          value={originalPassword}
          onChange={setOriginalPassword}
        />
        <PasswordInput
          label={t("settings.account.newPassword")}
          value={newPassword}
          onChange={setNewPassword}
        />
        <PasswordInput
          label={t("settings.account.confirmNewPassword")}
          value={confirmPassword}
          onChange={setConfirmPassword}
        />
        {error && (
          <p role="alert" className="text-xs text-status-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

function PasswordInput(props: PasswordInputProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  return (
    <div>
      <label className="block text-xs text-text-ink/65 mb-1.5 font-normal">
        {props.label}
      </label>
      <div className="relative">
        <input
          ref={props.inputRef}
          type={show ? "text" : "password"}
          aria-label={props.label}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className="w-full px-4 py-2.5 pr-10 border border-border-stone rounded-input text-sm bg-background-paper focus:outline-none"
        />
        <button
          type="button"
          aria-label={show ? t("settings.account.hidePassword") : t("settings.account.showPassword")}
          onClick={() => setShow((value) => !value)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-ink/40 hover:text-text-ink/65 cursor-pointer"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { registerUser, resetPassword } from "@/lib/dataService";
import { normalizePhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import { phonePrefixOptions } from "@/data/phonePrefixes";
import styles from "./page.module.css";

const PHONE_PREFIXES = phonePrefixOptions();

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [authStep, setAuthStep] = useState("form"); // "form" | "otp" | "newPass"
  const [otpMode, setOtpMode] = useState("login"); // "login" | "register" | "reset"
  const [resetPhone, setResetPhone] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPassConfirm, setNewPassConfirm] = useState("");

  // Fields
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [prefix, setPrefix] = useState("+34");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpTimer, setOtpTimer] = useState(60);
  const [pendingEmail, setPendingEmail] = useState("");
  const [otpKey, setOtpKey] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Validation
  const [phoneError, setPhoneError] = useState(null);
  const [usernameError, setUsernameError] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [otpError, setOtpError] = useState(null);
  const [conflictUser, setConflictUser] = useState(null);

  // Login identifier
  const [loginId, setLoginId] = useState(""); // email or phone

  const fullPhone = `${prefix}${phoneLocal.replace(/\s/g, "")}`;

  // --- OTP Countdown Timer ---
  useEffect(() => {
    if (authStep === "otp" && otpTimer > 0) {
      const interval = setInterval(() => setOtpTimer((t) => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [authStep, otpTimer]);

  // --- REAL-TIME Phone Duplicate Check ---
  const checkPhone = (localNumber) => {
    setPhoneError(null);
    setConflictUser(null);
  };

  // --- REAL-TIME Username Duplicate Check ---
  const checkUsername = (val) => {
    setUsernameError(null);
  };

  // --- REAL-TIME Email Duplicate Check ---
  const checkEmail = (val) => {
    setEmailError(null);
  };

  // --- Send OTP ---
  const handleSendOTP = async (e) => {
    e.preventDefault();

    if (!isLogin) {
      if (phoneError || usernameError || emailError) return;
      if (!fullName.trim() || !username.trim() || !email.trim() || !phoneLocal.trim() || !password) return;
    }

    setOtpError(null);
    setOtpInput("");

    // El código SIEMPRE se envía por SMS:
    //  - Registro: al teléfono introducido.
    //  - Login: al teléfono asociado (si el identificador es un email,
    //    el servidor resuelve el teléfono de la cuenta).
    const id = String(isLogin ? loginId : "").trim();
    const smsPhone = isLogin
      ? id.includes("@")
        ? ""
        : normalizePhone(id)
      : fullPhone;

    if (isLogin && !smsPhone && !id.includes("@")) {
      setOtpError("Introduce tu email o teléfono para recibir el código SMS.");
      return;
    }

    setSendingOtp(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: smsPhone,
          email: isLogin && id.includes("@") ? id : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.error || "No se pudo enviar el SMS. Inténtalo de nuevo.");
        return;
      }
      setPendingEmail(id.includes("@") ? id : (!isLogin ? email.trim() : ""));
      setOtpKey(json.otpKey || smsPhone || fullPhone);
      setOtpCode(json.demoCode || "");
      if (json.demoCode) setOtpInput(json.demoCode);
      setOtpTimer(60);
      setOtpMode(isLogin ? "login" : "register");
      setAuthStep("otp");
    } catch {
      setOtpError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setSendingOtp(false);
    }
  };

  // --- Iniciar recuperación de contraseña (envía SMS al número del login) ---
  const startForgotPassword = async () => {
    const id = String(loginId).trim();
    if (!id) {
      setOtpError("Introduce tu email o teléfono en el campo de arriba para que te enviemos el SMS.");
      return;
    }

    let phone = "";
    let email = "";
    if (id.includes("@")) {
      const user = findUserByEmail(id);
      if (!user) {
        setOtpError("No encontramos ninguna cuenta con ese email.");
        return;
      }
      phone = user.phone;
      email = id;
    } else {
      phone = normalizePhone(id);
      if (!phone) {
        setOtpError("Introduce un número de teléfono válido.");
        return;
      }
    }

    setResetPhone(phone);
    setResetEmail(email);
    setOtpInput("");
    setOtpError(null);
    setSendingOtp(true);

    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.error || "No se pudo enviar el SMS. Inténtalo de nuevo.");
        return;
      }
      setOtpKey(json.otpKey || phone);
      setOtpCode(json.demoCode || "");
      if (json.demoCode) setOtpInput(json.demoCode);
      setOtpTimer(60);
      setOtpMode("reset");
      setAuthStep("otp");
    } catch {
      setOtpError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setSendingOtp(false);
    }
  };

  // --- Verify OTP ---
  const verifyCode = async (code) => {
    setOtpError(null);

    const id = String(isLogin ? loginId : "").trim();
    const smsPhone = isLogin
      ? id.includes("@")
        ? ""
        : normalizePhone(id)
      : fullPhone;

    setVerifying(true);
    try {
      const res = await fetch("/api/sms/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otpKey: otpKey || smsPhone || fullPhone,
          code,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.error || "Código incorrecto. Revisa el SMS y vuelve a intentarlo.");
        return;
      }

      // Recuperación de contraseña: tras verificar el SMS, pedimos la nueva contraseña
      if (otpMode === "reset") {
        setAuthStep("newPass");
        return;
      }

      if (!isLogin) {
        const newUser = {
          fullName,
          username: username.replace("@", ""),
          email,
          phone: fullPhone,
          password,
          registeredAt: new Date().toISOString(),
        };
        let created;
        try {
          created = await registerUser(newUser);
        } catch (regErr) {
          setOtpError(regErr?.message || "No se pudo crear la cuenta. Inténtalo de nuevo.");
          setVerifying(false);
          return;
        }
        const fullSession = {
          ...created,
          ...newUser,
          id: created?.id,
          email: created?.email || email,
          name: created?.name || fullName,
          username: created?.username || username.replace("@", ""),
          initials: created?.name
            ? String(created.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
            : (fullName || "U").charAt(0).toUpperCase(),
          balance: created?.balance || 0,
          verified: true,
        };

        // Crear sesión Supabase para obtener Bearer token
        if (supabase) {
          try {
            const { data: sessionData } = await supabase.auth.signInWithPassword({ email, password });
            if (sessionData?.session?.access_token) {
              fullSession.access_token = sessionData.session.access_token;
            }
          } catch (e) {
            console.warn("[Auth] No se pudo crear sesión Supabase:", e?.message);
          }
        }

        localStorage.setItem("colecciona_session", JSON.stringify(fullSession));
      } else {
        const id = String(loginId).trim();
        const mockUser = id.includes("@") ? findUserByEmail(id) : findUserByPhone(id.replace(/[^\d+]/g, ""));
        const sessionUser = json.user || mockUser;
        if (!sessionUser) {
          setOtpError("No existe ninguna cuenta asociada a este teléfono. Regístrate para crear una.");
          return;
        }

        // Crear sesión Supabase con la contraseña temporal del servidor
        if (supabase && json.tempPassword && sessionUser?.email) {
          try {
            const { data: sessionData } = await supabase.auth.signInWithPassword({
              email: sessionUser.email,
              password: json.tempPassword,
            });
            if (sessionData?.session?.access_token) {
              sessionUser.access_token = sessionData.session.access_token;
            }
          } catch (e) {
            console.warn("[Auth] No se pudo crear sesión Supabase:", e?.message);
          }
        }

        const sessionName = sessionUser.name || sessionUser.email || "Usuario";
        localStorage.setItem("colecciona_session", JSON.stringify({
          ...sessionUser,
          initials: sessionUser.initials || String(sessionName).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
          balance: sessionUser.balance || 0,
          verified: true,
        }));
      }
      window.location.href = "/";
    } catch {
      setOtpError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyOTP = () => verifyCode(otpInput);

  const handleResendOTP = async () => {
    setOtpError(null);
    setOtpInput("");
    const id = String(isLogin ? loginId : "").trim();
    const smsPhone = otpMode === "reset"
      ? resetPhone
      : isLogin
        ? id.includes("@")
          ? ""
          : normalizePhone(id)
        : fullPhone;
    setSendingOtp(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: smsPhone,
          email: otpMode === "reset" ? undefined : (isLogin && id.includes("@") ? id : undefined),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setOtpError(json.error || "No se pudo reenviar el SMS. Inténtalo de nuevo.");
        return;
      }
      setOtpKey(json.otpKey || smsPhone || fullPhone);
      setOtpCode(json.demoCode || "");
      if (json.demoCode) setOtpInput(json.demoCode);
      setOtpTimer(60);
    } catch {
      setOtpError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setSendingOtp(false);
    }
  };

  // --- New Password Screen (tras verificar SMS de recuperación) ---
  if (authStep === "newPass") {
    const handleNewPassword = async () => {
      if (newPass.length < 8) {
        setOtpError("La contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (newPass !== newPassConfirm) {
        setOtpError("Las contraseñas no coinciden.");
        return;
      }
      setOtpError(null);
      setSendingOtp(true);
      try {
        await resetPassword(resetEmail || resetPhone, newPass);
        setNewPass("");
        setNewPassConfirm("");
        setResetPhone("");
        setResetEmail("");
        setLoginId("");
        setIsLogin(true);
        setAuthStep("form");
        setOtpMode("login");
        setOtpError(null);
      } catch {
        setOtpError("No se pudo guardar la nueva contraseña. Inténtalo de nuevo.");
      } finally {
        setSendingOtp(false);
      }
    };

    return (
      <div className={`${styles.wrapper} page-enter`}>
        <div className={styles.card}>
          <div className={styles.otpHeader}>
            <button className={styles.backBtn} onClick={() => { setOtpError(null); setAuthStep("otp"); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Atrás
            </button>
            <div className={styles.otpIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L10.6 8.2a2 2 0 0 1-1.4 1.4L3 11l6.2 1.4a2 2 0 0 1 1.4 1.4L12 20l1.4-6.2a2 2 0 0 1 1.4-1.4L21 11l-6.2-1.4a2 2 0 0 1-1.4-1.4z" />
              </svg>
            </div>
            <h2>Nueva contraseña</h2>
            <p>Define una nueva contraseña para tu cuenta.</p>
          </div>

          <form className={styles.form} onSubmit={(e) => { e.preventDefault(); handleNewPassword(); }}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-pass">Nueva contraseña *</label>
              <div className={styles.passWrapper}>
                <input
                  id="new-pass"
                  type={showPassword ? "text" : "password"}
                  className={styles.input}
                  placeholder="Mínimo 8 caracteres"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Ocultar" : "Mostrar"}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-pass-confirm">Confirmar contraseña *</label>
              <input
                id="new-pass-confirm"
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="Repite la contraseña"
                value={newPassConfirm}
                onChange={(e) => setNewPassConfirm(e.target.value)}
              />
            </div>

            {otpError && (
              <div className={styles.errorBanner}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {otpError}
              </div>
            )}

            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={sendingOtp}
            >
              {sendingOtp ? "Guardando..." : "Guardar nueva contraseña"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- OTP Screen ---
  if (authStep === "otp") {
    const displayPhone = otpMode === "reset"
      ? `${resetPhone.slice(0, 5)} *** ${resetPhone.slice(-3)}`
      : isLogin
        ? `${pendingEmail || "tu número"}`
        : `${prefix} ${phoneLocal.slice(0, 3)} *** ${phoneLocal.slice(-3)}`;

    return (
      <div className={`${styles.wrapper} page-enter`}>
        <div className={styles.card}>
          <div className={styles.otpHeader}>
            <button className={styles.backBtn} onClick={() => { setOtpError(null); setAuthStep("form"); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Atrás
            </button>
            <div className={styles.otpIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            </div>
            <h2>{otpMode === "reset" ? "Recuperar contraseña" : "Verificación SMS"}</h2>
            <p>Hemos enviado un código de 6 dígitos por SMS a <strong>{displayPhone}</strong>. Válido durante <strong>{otpTimer}s</strong>.</p>
          </div>

          <div className={styles.form}>
            <div className={styles.otpBoxRow}>
              {[0,1,2,3,4,5].map((i) => (
                <div key={i} className={`${styles.otpDigitBox} ${otpInput.length > i ? styles.otpFilled : ""}`}>
                  {otpInput[i] || ""}
                </div>
              ))}
            </div>

            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              className={styles.otpHiddenInput}
              value={otpInput}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtpInput(val);
                setOtpError(null);
                if (val.length === 6) {
                  setTimeout(() => verifyCode(val), 300);
                }
              }}
              autoFocus
            />

            {otpCode && (
              <div className={styles.demoCodeBox}>
                📱 <strong>Modo demo</strong> (sin proveedor SMS): tu código es{" "}
                <strong className={styles.demoCodeValue}>{otpCode}</strong>. Se introduce automáticamente.
              </div>
            )}

            {otpError && (
              <div className={styles.errorBanner}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {otpError}
              </div>
            )}

            <button
              className={styles.primaryBtn}
              onClick={handleVerifyOTP}
              disabled={otpInput.length < 6 || verifying}
            >
              {verifying ? "Verificando..." : otpMode === "reset" ? "Verificar Código" : "Verificar Código y Continuar"}
            </button>

            <div className={styles.resendRow}>
            {otpTimer > 0 ? (
              <span className={styles.resendMuted}>Reenviar SMS en {otpTimer}s</span>
            ) : (
              <button className={styles.resendBtn} onClick={handleResendOTP}>
                Reenviar SMS
              </button>
            )}
          </div>

          <div className={styles.antifraudNotice}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Sistema Anti-Fraude Colecciona. Este número no podrá vincularse a otra cuenta.
          </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Form ---
  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className={styles.card}>
        {/* Logo */}
        <Link href="/" className={styles.brandRow}>
          <div className={styles.brandBadge}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className={styles.brandName}>COLECC<span className={styles.brandAccent}>IONA</span></span>
        </Link>

        {/* Tabs */}
        <div className={styles.tabGroup}>
          <button
            className={`${styles.tab} ${isLogin ? styles.tabActive : ""}`}
            onClick={() => { setIsLogin(true); setPhoneError(null); setConflictUser(null); }}
          >
            Iniciar Sesión
          </button>
          <button
            className={`${styles.tab} ${!isLogin ? styles.tabActive : ""}`}
            onClick={() => { setIsLogin(false); setPhoneError(null); setConflictUser(null); }}
          >
            Crear Cuenta
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSendOTP}>

          {/* ── REGISTRO ── */}
          {!isLogin && (
            <>
              {/* Full Name */}
              <div className={styles.field}>
                <label className={styles.label} htmlFor="full-name">Nombre y Apellidos *</label>
                <input
                  id="full-name"
                  type="text"
                  className={styles.input}
                  placeholder="Ej. Carlos Ruiz Gómez"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              {/* Username */}
              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">Nombre de usuario *</label>
                <div className={styles.inputPrefix}>
                  <span className={styles.prefixAt}>@</span>
                  <input
                    id="username"
                    type="text"
                    className={`${styles.input} ${styles.inputWithPrefix}`}
                    placeholder="cruiz_tcg"
                    value={username}
                    onChange={(e) => {
                      const val = e.target.value.replace("@", "").toLowerCase().replace(/[^a-z0-9_]/g, "");
                      setUsername(val);
                      checkUsername(val);
                    }}
                    required
                    autoComplete="username"
                  />
                </div>
                {usernameError && (
                  <div className={styles.fieldError}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {usernameError}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Email */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              {isLogin ? "Email o Teléfono *" : "Correo electrónico *"}
            </label>
            <input
              id="email"
              type={isLogin ? "text" : "email"}
              className={`${styles.input} ${emailError ? styles.inputError : ""}`}
              placeholder={isLogin ? "tu@email.com o 600 00 00 00" : "tu@email.com"}
              value={isLogin ? loginId : email}
              onChange={(e) => {
                if (isLogin) {
                  setLoginId(e.target.value);
                } else {
                  setEmail(e.target.value);
                  checkEmail(e.target.value);
                }
              }}
              required
              autoComplete="email"
            />
            {emailError && (
              <div className={styles.fieldError}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {emailError}
              </div>
            )}
          </div>

          {/* Phone — REGISTRO + siempre visible */}
          {!isLogin && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="phone">
                Número de Teléfono *
              </label>
              <div className={styles.phoneRow}>
                <select
                  className={styles.prefixSelect}
                  value={prefix}
                  onChange={(e) => {
                    setPrefix(e.target.value);
                    if (phoneLocal) checkPhone(phoneLocal);
                  }}
                >
                  {PHONE_PREFIXES.map((p) => (
                    <option key={p.id} value={p.code}>{p.flag} {p.label} ({p.code})</option>
                  ))}
                </select>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  className={`${styles.input} ${styles.phoneInput} ${phoneError ? styles.inputError : ""}`}
                  placeholder="600 000 000"
                  value={phoneLocal}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d\s]/g, "");
                    setPhoneLocal(val);
                    checkPhone(val);
                  }}
                  required
                  autoComplete="tel"
                />
              </div>

              {/* Anti-Multiaccounting Robot Alert */}
              {phoneError && conflictUser && (
                <div className={styles.antiAccountAlert}>
                  <div className={styles.alertHeader}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span>SISTEMA ANTI-MULTICUENTA COLECCIONA</span>
                  </div>
                  <p>
                    El número <strong>{prefix} {phoneLocal}</strong> ya está vinculado a la cuenta activa
                    de <strong>{conflictUser.name}</strong> (<strong>@{conflictUser.username}</strong>).
                  </p>
                  <p className={styles.alertSub}>
                    Nuestra plataforma prohíbe de forma estricta la creación de múltiples cuentas para garantizar un mercado seguro, libre de bots y fraudes. Si crees que esto es un error, contacta con soporte.
                  </p>
                  <div className={styles.alertActions}>
                    <Link href="/auth" onClick={() => { setIsLogin(true); setPhoneError(null); setConflictUser(null); }} className={styles.alertLogin}>
                      Iniciar sesión en esa cuenta
                    </Link>
                    <Link href="#" className={styles.alertSupport}>Contactar soporte</Link>
                  </div>
                </div>
              )}

              {phoneLocal.replace(/\s/g, "").length >= 7 && !phoneError && (
                <div className={styles.phoneOk}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Se enviará un SMS de verificación a este número si está disponible.
                </div>
              )}
            </div>
          )}

          {/* Password */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Contraseña *</label>
            <div className={styles.passWrapper}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={8}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar" : "Mostrar"}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {isLogin && (
              <span role="button" tabIndex={0} className={styles.forgotLink} onClick={startForgotPassword} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startForgotPassword(); } }}>¿Olvidaste tu contraseña?</span>
            )}
          </div>

          {/* Submit — pide OTP */}
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={!isLogin && (!!phoneError || !!usernameError || !!emailError)}
          >
            {isLogin
              ? "Continuar con verificación SMS"
              : "Crear cuenta — Verificar teléfono"}
          </button>

          {/* Terms on register */}
          {!isLogin && (
            <p className={styles.terms}>
              Al registrarte aceptas usar exclusivamente una cuenta personal por persona, verificar tu teléfono y los{" "}
              <Link href="/terminos">Términos de Servicio</Link> y{" "}
              <Link href="/privacidad">Política de Privacidad</Link> de Colecciona.
            </p>
          )}
        </form>

        {/* Security Notice */}
        <div className={styles.securityRow}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>La forma segura de comprar y vender tus cromos</span>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useApp } from '@/context/AppContext';
import styles from './ToastContainer.module.css';
import { useEffect, useState } from 'react';

const SuccessIcon = () => (
  <svg className={styles.iconSuccess} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
);

const ErrorIcon = () => (
  <svg className={styles.iconError} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
);

const InfoIcon = () => (
  <svg className={styles.iconInfo} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
);

const WarningIcon = () => (
  <svg className={styles.iconWarning} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
);

const Toast = ({ toast }) => {
  const { id, message, type = 'info' } = toast;
  
  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <div className={styles.iconContainer}>
        {type === 'success' && <SuccessIcon />}
        {type === 'error' && <ErrorIcon />}
        {type === 'info' && <InfoIcon />}
        {type === 'warning' && <WarningIcon />}
      </div>
      <div className={styles.message}>{message}</div>
    </div>
  );
};

export default function ToastContainer() {
  const { toasts } = useApp();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

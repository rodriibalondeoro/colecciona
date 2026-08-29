import { useEffect, useRef } from "react";

export function useScrollReveal(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          observer.unobserve(el);
        }
      },
      { threshold: options.threshold ?? 0.1, rootMargin: options.rootMargin ?? "0px 0px -40px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [options.threshold, options.rootMargin]);

  return ref;
}

export function useStaggerReveal(options = {}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const children = container.children;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          Array.from(children).forEach((child, i) => {
            child.style.animationDelay = `${i * (options.delay ?? 60)}ms`;
            child.classList.add("stagger-reveal");
          });
          observer.unobserve(container);
        }
      },
      { threshold: options.threshold ?? 0.05, rootMargin: options.rootMargin ?? "0px 0px -20px 0px" }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [options.delay, options.threshold, options.rootMargin]);

  return containerRef;
}

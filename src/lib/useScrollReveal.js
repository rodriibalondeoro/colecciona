import { useEffect, useRef } from "react";

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

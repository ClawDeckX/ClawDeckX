import { useState, useEffect, useCallback, useMemo } from 'react';
import { findFastestMirror, GITHUB_MIRRORS, transformGitHubURL, isLikelyInChina } from '../services/network';

interface SmartLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
}

/**
 * SmartLink - Intelligent link component that automatically selects the best mirror
 * for GitHub URLs based on user location and network conditions.
 * 
 * For international users: Uses direct GitHub links
 * For China users: Automatically uses the fastest available mirror
 */
export function SmartLink({ href, children, className, title, target = '_blank', rel = 'noopener noreferrer' }: SmartLinkProps) {
  const [resolvedHref, setResolvedHref] = useState(href);
  const isGitHubLink = useMemo(() => href.includes('github.com'), [href]);

  useEffect(() => {
    if (!isGitHubLink) {
      setResolvedHref(href);
      return;
    }

    // Only optimize for users likely in China
    if (!isLikelyInChina()) {
      setResolvedHref(href);
      return;
    }

    // Find best mirror and transform URL
    let mounted = true;
    findFastestMirror(GITHUB_MIRRORS, '/ClawDeckX/ClawDeckX', 'github', 3000)
      .then(mirror => {
        if (mounted) {
          const transformed = transformGitHubURL(href, mirror);
          setResolvedHref(transformed);
        }
      })
      .catch(() => {
        // On error, use original URL
        if (mounted) setResolvedHref(href);
      });

    return () => { mounted = false; };
  }, [href, isGitHubLink]);

  return (
    <a href={resolvedHref} className={className} title={title} target={target} rel={rel}>
      {children}
    </a>
  );
}

/**
 * Hook to get a smart GitHub URL
 */
export function useSmartGitHubURL(originalURL: string): string {
  const [url, setUrl] = useState(originalURL);

  useEffect(() => {
    if (!originalURL.includes('github.com')) {
      setUrl(originalURL);
      return;
    }

    if (!isLikelyInChina()) {
      setUrl(originalURL);
      return;
    }

    let mounted = true;
    findFastestMirror(GITHUB_MIRRORS, '/ClawDeckX/ClawDeckX', 'github', 3000)
      .then(mirror => {
        if (mounted) {
          setUrl(transformGitHubURL(originalURL, mirror));
        }
      })
      .catch(() => {
        if (mounted) setUrl(originalURL);
      });

    return () => { mounted = false; };
  }, [originalURL]);

  return url;
}

export default SmartLink;

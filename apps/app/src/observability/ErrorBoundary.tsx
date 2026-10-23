import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ErrorBoundaryProps } from 'expo-router'
import { Button, ScreenShell, colors, space, textStyle, type } from '@pawpin/ui'

import { ContentColumn } from '../layout/ContentColumn'
import { errorCopy } from './copy'
import { reportError } from './sentry'

/**
 * What a route shows when something it renders throws. The words are the same for every error:
 * the error itself (its message can carry a name, an email or a file path) goes only to Sentry,
 * scrubbed, and only when Sentry is on.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <ScreenShell flow="resilience" scroll>
      <ContentColumn style={styles.column}>
        {/* Plain text in a live region: it never animates, and is read out when it appears. */}
        <View
          testID="error-status"
          role="alert"
          accessibilityLiveRegion="polite"
          style={styles.message}
        >
          <Text accessibilityRole="header" style={styles.title}>
            {errorCopy.title}
          </Text>
          <Text style={styles.body}>{errorCopy.body}</Text>
        </View>
        <Button label={errorCopy.retry} variant="primary" onPress={() => void retry()} />
      </ContentColumn>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  column: { flexGrow: 1, justifyContent: 'center', gap: space[24], paddingVertical: space[32] },
  message: { gap: space[8] },
  title: { ...textStyle(type.section), color: colors.deepBlue, textAlign: 'center' },
  body: { ...textStyle(type.body), color: colors.slate, textAlign: 'center' },
})

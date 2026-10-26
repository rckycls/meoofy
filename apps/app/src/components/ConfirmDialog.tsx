import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button, Card, cardRoles, colors, space, textStyle, type } from '@meoofy/ui'

export type ConfirmDialogProps = {
  visible: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  /** The confirmed action is running: it shows progress, and the dialog can't be dismissed. */
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * An in-app confirmation for a destructive action (`Alert.alert` does nothing on the web). A modal
 * `alertdialog` over a dimmed page, with the safe choice first and the urgent one second.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const close = () => {
    if (!busy) onCancel()
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.fill}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]} />
        {/* Larger text scrolls the dialog instead of clipping it. */}
        <ScrollView contentContainerStyle={styles.overlay}>
          <View
            role="alertdialog"
            aria-modal
            aria-label={title}
            accessibilityViewIsModal
            style={styles.dialog}
          >
            <Card role="warning" title={title}>
              <Text style={[styles.body, { color: cardRoles.warning.body }]}>{body}</Text>
              {/* Cancel comes first: the web focus trap puts focus on the first control, and a
                  key press right after the dialog opens must not delete anything. */}
              <View style={styles.actions}>
                <Button variant="secondary" label={cancelLabel} disabled={busy} onPress={close} />
                <Button variant="urgent" label={confirmLabel} loading={busy} onPress={onConfirm} />
              </View>
            </Card>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space[24] },
  // The page behind, dimmed with the deep blue; the dialog itself stays fully opaque.
  backdrop: { backgroundColor: colors.deepBlue, opacity: 0.5 },
  dialog: { width: '100%', maxWidth: 420 },
  body: textStyle(type.body),
  actions: { gap: space[8], marginTop: space[8] },
})

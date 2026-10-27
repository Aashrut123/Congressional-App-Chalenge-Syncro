
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/features/theme/ThemeProvider';
import { APPEARANCE_THEMES, useAppearance } from '@/lib/AppearanceProvider';



type AppearanceSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export default function AppearanceSheet({
  visible,
  onClose,
}: AppearanceSheetProps) {
  const {
    themeName: selectedTheme,
    setThemeName,
    palette,
    largeText,
    setLargeText,
    highContrast,
    setHighContrast,
    reducedMotion,
    setReducedMotion,
  } = useAppearance();
  const { setPreference } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close appearance settings"
        />

        <SafeAreaView style={[styles.sheet, { backgroundColor: palette.card }]} edges={['bottom']}>
                    <View style={[styles.handle, { backgroundColor: palette.border }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: palette.text }]}>
                Personalize Your Syncro App!
              </Text>

              <Text style={[styles.subtitle, { color: palette.muted }]}>
                Choose the options you desire
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              hitSlop={10}
            >
              <Text style={[styles.closeText, { color: palette.muted }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={[styles.sectionTitle, { color: palette.text }]}>
                APPEARANCE
                </Text>

            <Text style={[styles.description, { color: palette.muted }]}>
              Choose a color theme from the presets below.
            </Text>

            <View style={styles.themeGrid}>
              {Object.values(APPEARANCE_THEMES).map((item) => {
                const selected = selectedTheme === item.name;

                return (
                  <Pressable
                    key={item.name}
                    onPress={() => {
                      setThemeName(item.name);
                      if (item.name === 'Light') setPreference('light');
                      if (item.name === 'Dark') setPreference('dark');
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${item.name} theme`}
                    style={[
                      styles.themeOption,
                      { borderColor: palette.border },
                      selected && { borderColor: palette.accent },
                    ]}
                  >
                    <View
                      style={[
                        styles.preview,
                        { backgroundColor: item.background },
                      ]}
                    >
                      <View
                        style={[
                          styles.previewCard,
                          { backgroundColor: item.card },
                        ]}
                      >
                        <View
                          style={[
                            styles.previewAccent,
                            { backgroundColor: item.accent },
                          ]}
                        />

                        <View
                          style={[
                            styles.previewLine,
                            {
                              backgroundColor: item.text,
                              opacity: highContrast ? 0.9 : 0.55,
                            },
                          ]}
                        />

                        <View
                          style={[
                            styles.previewLineShort,
                            {
                              backgroundColor: item.text,
                              opacity: highContrast ? 0.7 : 0.35,
                            },
                          ]}
                        />
                      </View>
                    </View>

                    <View style={styles.themeLabelRow}>
                      <Text
                        style={[
                          styles.themeName,
                          { color: palette.text },
                          largeText && styles.largeText,
                        ]}
                      >
                        {item.name}
                      </Text>

                      {selected && (
                        <Text style={[styles.checkmark, { color: palette.accent }]}>
                            ✓
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionTitle, { color: palette.muted }]}>
                ACCESSIBILITY
            </Text>

            <View style={[styles.settingRow, { borderBottomColor: palette.border }]}>
              <View style={styles.settingInfo}>
                <Text
                  style={[
                    styles.settingTitle,
                    { color: palette.text },
                    largeText && styles.largeText,
                  ]}
                >
                  Larger text
                </Text>

                <Text
                  style={[
                    styles.settingDescription,
                    { color: palette.muted },
                    largeText && styles.largeDescription,
                  ]}
                >
                  Make interface text easier to read.
                </Text>
              </View>

              <Switch
                value={largeText}
                onValueChange={setLargeText}
                accessibilityLabel="Larger text"
                trackColor={{ false: palette.border, true: palette.accent }}
              />
            </View>

            <View style={[styles.settingRow, { borderBottomColor: palette.border }]}>
              <View style={styles.settingInfo}>
                <Text
                  style={[
                    styles.settingTitle,
                    { color: palette.text },
                    largeText && styles.largeText,
                  ]}
                >
                  High contrast
                </Text>

                <Text
                  style={[
                    styles.settingDescription,
                    { color: palette.muted },
                    largeText && styles.largeDescription,
                  ]}
                >
                  Improve text and element visibility.
                </Text>
              </View>

              <Switch
                value={highContrast}
                onValueChange={setHighContrast}
                accessibilityLabel="High contrast"
                trackColor={{ false: palette.border, true: palette.accent }}
              />
            </View>

            <View style={[styles.settingRow, { borderBottomColor: palette.border }]}>
              <View style={styles.settingInfo}>
                <Text
                  style={[
                    styles.settingTitle,
                    { color: palette.text },
                    largeText && styles.largeText,
                  ]}
                >
                  Reduced motion
                </Text>

                <Text
                  style={[
                    styles.settingDescription,
                    { color: palette.muted },
                    largeText && styles.largeDescription,
                  ]}
                >
                  Turn off the panel slide animation.
                </Text>
              </View>

              <Switch
                value={reducedMotion}
                onValueChange={setReducedMotion}
                accessibilityLabel="Reduced motion"
                trackColor={{ false: palette.border, true: palette.accent }}
              />
            </View>

            <Pressable
                style={[
                    styles.doneButton,
                    { backgroundColor: palette.accent },
                ]}
                onPress={onClose}
                accessibilityRole="button"
                >
                <Text
                    style={[
                    styles.doneText,
                    { color: palette.accentText },
                    ]}
                >
                    Done
                </Text>
                </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 12,
    maxHeight: '88%',
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 5,
  },
  closeButton: {
    padding: 8,
    marginLeft: 8,
  },
  closeText: {
    fontSize: 20,
    color: '#6B7280',
  },
  content: {
    paddingBottom: 18,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    color: '#6B7280',
    marginBottom: 14,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  themeOption: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '42%',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 8,
  },
  selectedTheme: {
    borderColor: '#2563EB',
  },
  preview: {
    height: 78,
    borderRadius: 8,
    padding: 7,
  },
  previewCard: {
    flex: 1,
    borderRadius: 5,
    padding: 7,
    justifyContent: 'center',
    gap: 5,
  },
  previewAccent: {
    height: 8,
    width: '65%',
    borderRadius: 4,
  },
  previewLine: {
    height: 4,
    width: '85%',
    borderRadius: 3,
  },
  previewLineShort: {
    height: 4,
    width: '52%',
    borderRadius: 3,
  },
  themeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 2,
  },
  themeName: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2563EB',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  settingInfo: {
    flex: 1,
    paddingRight: 12,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  settingDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6B7280',
    marginTop: 4,
  },
  largeText: {
    fontSize: 18,
  },
  largeDescription: {
    fontSize: 15,
    lineHeight: 22,
  },
  highContrastText: {
    color: '#000000',
  },
  highContrastDescription: {
    color: '#333333',
  },
  doneButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  doneText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});

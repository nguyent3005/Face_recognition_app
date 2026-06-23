import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import { Calendar, Clock, MapPin, Users, BookOpen, ChevronDown, X, Check } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { getClasses, getClassSessions, getSessions } from '../utils/api';
import { colors, spacing, radius, shadow } from '../theme';
import { getCurrentUser } from '../utils/auth';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Chào buổi sáng';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export default function HomeScreen({ navigation }) {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null); // null = "Tất cả lớp học"
  const [sessions, setSessions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);

  const loadClasses = async () => {
    try {
      setError(null);
      const [classesRes, currentUser] = await Promise.all([
        getClasses(),
        getCurrentUser()
      ]);
      const validClasses = Array.isArray(classesRes) ? classesRes : [];
      setClasses(validClasses);
      setUser(currentUser);
    } catch (err) {
      setError(err.message || 'Không tải được danh sách lớp');
    } finally {
      setLoadingClasses(false);
      setRefreshing(false);
    }
  };

  const loadSessions = async (classObj) => {
    setLoadingSessions(true);
    try {
      let res;
      if (classObj && classObj.id) {
        res = await getClassSessions(classObj.id);
      } else {
        // Fetch all sessions if no class selected
        res = await getSessions({});
      }
      setSessions(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err.message || 'Không tải được danh sách ca học');
    } finally {
      setLoadingSessions(false);
    }
  };

  useFocusEffect(useCallback(() => { 
    if (classes.length === 0) {
      loadClasses(); 
    }
    // Always load sessions when selectedClass changes or screen focuses
    loadSessions(selectedClass);
  }, [selectedClass]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadClasses();
    await loadSessions(selectedClass);
    setRefreshing(false);
  }, [selectedClass]);

  if (loadingClasses) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Đang tải dữ liệu...</Text>
      </View>
    );
  }

  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const greeting = getGreeting();
  const displayName = user?.full_name?.split(' ').pop() || 'bạn';

  const getStatusColor = (status) => {
    switch (status) {
      case 'ongoing': return colors.success;
      case 'upcoming': return colors.primary;
      case 'finished': return colors.textMuted;
      default: return colors.textSecondary;
    }
  };
  
  const getStatusBgColor = (status) => {
    switch (status) {
      case 'ongoing': return colors.successBg;
      case 'upcoming': return colors.primaryLight;
      case 'finished': return colors.borderLight;
      default: return 'transparent';
    }
  };

  // Label render logic
  let pickerLabel = "Tất cả lớp học";
  if (selectedClass) {
    pickerLabel = `${selectedClass.class_name} · ${selectedClass.class_code}`;
  }

  return (
    <View style={styles.container}>
      {/* ── Custom header ─────────────────────────────────────────────────── */}
      <LinearGradient
        colors={colors.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerDecor1} />
        <View style={styles.headerDecor2} />
        <View style={styles.headerContent}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingText}>{greeting} 👋</Text>
            <Text style={styles.greetingName}>{displayName}</Text>
            <Text style={styles.headerDate}>{today}</Text>
          </View>
          <View style={styles.headerBadge}>
            <Calendar color="#fff" size={18} strokeWidth={2} />
          </View>
        </View>
      </LinearGradient>

      {/* ── Modal Chọn Lớp ────────────────────────────────────────────────── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chọn lớp học</Text>
              <AppPressable onPress={() => setModalVisible(false)} scaleEnabled={false}>
                <X size={24} color={colors.text} />
              </AppPressable>
            </View>

            <FlatList
              data={[{ id: null, class_name: 'Tất cả lớp học' }, ...classes]}
              keyExtractor={(item) => (item.id || 'all').toString()}
              renderItem={({ item }) => {
                const isSelected = selectedClass?.id === item.id || (!selectedClass && !item.id);
                return (
                  <AppPressable
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                    onPress={() => {
                      setSelectedClass(item.id ? item : null);
                      setModalVisible(false);
                    }}
                    scaleEnabled={false}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemTitle, isSelected && { color: colors.primary }]}>
                        {item.class_name}
                      </Text>
                      {item.class_code && (
                        <Text style={styles.modalItemSub}>{item.class_code}</Text>
                      )}
                    </View>
                    {isSelected && <Check size={20} color={colors.primary} />}
                  </AppPressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.modalEmpty}>Chưa có lớp học nào</Text>
              }
              contentContainerStyle={{ paddingBottom: 20 }}
              style={{ maxHeight: 400 }}
            />
          </View>
        </View>
      </Modal>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        <View style={styles.pickerContainer}>
          <Text style={styles.sectionTitle}>Chọn lớp học</Text>
          <AppPressable
            style={styles.dropdownBtn}
            onPress={() => setModalVisible(true)}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.dropdownIconBox}>
                <BookOpen size={16} color={colors.primary} />
              </View>
              <Text style={[styles.dropdownText, !selectedClass && { color: colors.textSecondary }]}>
                {pickerLabel}
              </Text>
            </View>
            <ChevronDown size={20} color={colors.textMuted} />
          </AppPressable>
        </View>

        {/* ── Sessions List ─────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Lịch trong tuần</Text>
          {sessions.length > 0 && (
             <View style={styles.countBadge}>
               <Text style={styles.countBadgeText}>{sessions.length}</Text>
             </View>
          )}
        </View>

        {loadingSessions ? (
          <View style={styles.centeredInline}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.emptyBox}>
             <Text style={styles.emptyIcon}>😴</Text>
             <Text style={styles.empty}>
               {selectedClass ? 'Lớp này chưa có ca học trong tuần' : 'Không có ca học nào'}
             </Text>
          </View>
        ) : (
          sessions.map((session) => (
            <AppPressable 
              key={session.id} 
              style={styles.sessionCard}
              onPress={() => navigation.navigate('SessionDetail', { session_id: session.id })}
              scaleEnabled={false}
            >
              <View style={styles.sessionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subjectName}>{session.subject?.subject_name || 'Không rõ môn học'}</Text>
                  <Text style={styles.sectionCode}>Mã LHP: {session.section_code}</Text>
                  {/* Show Class Name if viewing "All Classes" */}
                  {!selectedClass && session.course_class && (
                    <Text style={[styles.sectionCode, { color: colors.primary, marginTop: 2, fontWeight: '600' }]}>
                      {session.course_class.class_name} ({session.course_class.class_code})
                    </Text>
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(session.status) }]}>
                  <Text style={[styles.statusText, { color: getStatusColor(session.status) }]}>
                    {session.status_label}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.sessionDetails}>
                <View style={styles.detailItem}>
                  <Calendar size={16} color={colors.textSecondary} style={styles.detailIcon} />
                  <Text style={styles.detailText}>{session.day_of_week}, {session.study_date}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Clock size={16} color={colors.textSecondary} style={styles.detailIcon} />
                  <Text style={styles.detailText}>
                    Tiết {session.lesson_start}-{session.lesson_end} ({new Date(session.start_time).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})} - {new Date(session.end_time).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})})
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <MapPin size={16} color={colors.textSecondary} style={styles.detailIcon} />
                  <Text style={styles.detailText}>Phòng {session.room}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Users size={16} color={colors.textSecondary} style={styles.detailIcon} />
                  <Text style={styles.detailText}>GV: {session.teachers?.map(t => t.full_name).join(', ') || 'Chưa phân công'}</Text>
                </View>
              </View>
            </AppPressable>
          ))
        )}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  centeredInline: { paddingVertical: spacing.xl, alignItems: 'center' },
  loadingText: { color: colors.textSecondary, fontSize: 14 },

  header: {
    paddingTop: 56,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    overflow: 'hidden',
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  headerDecor1: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -50,
    right: -30,
  },
  headerDecor2: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -20,
    right: 100,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    zIndex: 1,
  },
  greetingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
    marginBottom: 2,
  },
  greetingName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '400',
  },
  headerBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 90 },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
    fontSize: 13,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },

  // Dropdown UI
  pickerContainer: {
    marginBottom: spacing.lg,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 2,
  },
  dropdownIconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },

  // Modal classes
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'flex-end' 
  },
  modalContent: { 
    backgroundColor: colors.surface, 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    paddingBottom: 20 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: spacing.lg, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.borderLight 
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalItem: { 
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.borderLight 
  },
  modalItemSelected: {
    backgroundColor: colors.primaryLight,
  },
  modalItemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  modalItemSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  modalEmpty: { textAlign: 'center', padding: 30, color: colors.textMuted },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  countBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: spacing.sm,
  },
  countBadgeText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  empty: { color: colors.textMuted, textAlign: 'center', fontSize: 14 },

  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  subjectName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  sectionCode: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.sm,
  },
  sessionDetails: {
    gap: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIcon: {
    marginRight: 10,
  },
  detailText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    flex: 1,
  }
});

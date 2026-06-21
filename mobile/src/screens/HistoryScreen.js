import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  RefreshControl,
  Modal,
  FlatList,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Calendar, Search, Clock, CircleCheck, AlertCircle, ChevronDown, ChevronUp, X, Users, BookOpen
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../components/ScreenHeader';
import api from '../utils/api';
import { validateDateRange, parseApiError } from '../utils/validation';
import { colors, spacing, radius, shadow } from '../theme';
import AttendanceSubjectCard from '../components/AttendanceSubjectCard';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const formatDateStr = (d) => {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getCurrentWeekRange = () => {
  const today = new Date();
  const currentDay = today.getDay(); 
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  const sundayOffset = currentDay === 0 ? 0 : 7 - currentDay;

  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(today);
  sunday.setDate(today.getDate() + sundayOffset);
  sunday.setHours(23, 59, 59, 999);

  return {
    startOfWeek: monday,
    endOfWeek: sunday,
  };
};

export default function HistoryScreen() {
  const { startOfWeek, endOfWeek } = getCurrentWeekRange();
  const [startDate, setStartDate] = useState(startOfWeek);
  const [endDate, setEndDate] = useState(endOfWeek);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [activeDateField, setActiveDateField] = useState(null); // 'from' hoặc 'to'
  const [tempDate, setTempDate] = useState(new Date());
  
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState(null); // 'class' or 'session'
  const [modalData, setModalData] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [groupedHistory, setGroupedHistory] = useState([]);
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);
  const [isFilterManuallyExpanded, setIsFilterManuallyExpanded] = useState(false);

  const toggleGroup = (groupId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedGroupId(prev => prev === groupId ? null : groupId);
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      const res = await api.getClasses();
      setClasses(res || []);
    } catch (err) {
      console.log('Error fetching classes', err);
    }
  };

  const getLocalYYYYMMDD = (d) => {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  };

  const fetchHistory = async () => {
    const startIso = getLocalYYYYMMDD(startDate);
    const endIso = getLocalYYYYMMDD(endDate);
    const err = validateDateRange(startIso, endIso);
    if (err) {
      Alert.alert('Lỗi', err);
      return;
    }

    setLoading(true);
    setGroupedHistory([]);
    setExpandedGroupId(null);
    try {
      let targetSessions = [];
      
      if (selectedSession) {
        targetSessions = [selectedSession];
      } else {
        const params = { start_date: startIso, end_date: endIso };
        if (selectedClass) params.class_id = selectedClass.id;
        targetSessions = await api.getSessions(params);
      }

      if (!targetSessions || targetSessions.length === 0) {
        setGroupedHistory([]);
        setLoading(false);
        return;
      }

      // Nhóm theo session_id + ngày học
      const sessionGroups = {};
      
      await Promise.all(targetSessions.map(async (sess) => {
        const groupKey = `${sess.id}_${sess.study_date}`;
        try {
          const students = await api.getSessionStudents(sess.id);
          
          let total = students.length;
          let present = 0;
          let late = 0;
          let absent = 0;

          students.forEach(s => {
            if (s.status === 'present') present++;
            else if (s.status === 'late') { present++; late++; }
            else absent++; // absent or not_checked_in
          });

          sessionGroups[groupKey] = {
            session: sess,
            students: students,
            stats: { total, present, late, absent }
          };
        } catch (e) {
          console.log(`Error fetching students for session ${sess.id}`, e);
        }
      }));

      // Convert sang array và sort theo ngày, giờ
      const groupedArray = Object.values(sessionGroups).sort((a, b) => {
        const timeA = new Date(`${a.session.study_date}T${a.session.start_time.split('T')[1]}`).getTime();
        const timeB = new Date(`${b.session.study_date}T${b.session.start_time.split('T')[1]}`).getTime();
        return timeA - timeB; // Sắp xếp theo trình tự thời gian (cũ nhất lên đầu)
      });

      setGroupedHistory(groupedArray);
      
      // Auto-collapse sau khi tra cứu có dữ liệu
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsFilterCollapsed(true);
      setIsFilterManuallyExpanded(false);
      
    } catch (error) {
      Alert.alert('Lỗi', parseApiError(error));
    } finally {
      setLoading(false);
    }
  };

  // Tự động load lần đầu
  useFocusEffect(useCallback(() => { 
    if (groupedHistory.length === 0 && !loading) {
      fetchHistory(); 
    }
  }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const openClassModal = () => {
    setModalType('class');
    setModalData(classes);
    setModalVisible(true);
  };

  const openSessionModal = async () => {
    setModalType('session');
    setModalVisible(true);
    setModalLoading(true);
    try {
      const startIso = getLocalYYYYMMDD(startDate);
      const endIso = getLocalYYYYMMDD(endDate);
      const params = { start_date: startIso, end_date: endIso };
      if (selectedClass) params.class_id = selectedClass.id;
      const res = await api.getSessions(params);
      setModalData(res || []);
    } catch (err) {
      Alert.alert('Lỗi', 'Không thể lấy danh sách ca học');
      setModalVisible(false);
    } finally {
      setModalLoading(false);
    }
  };

  const handleSelectOption = (item) => {
    if (modalType === 'class') {
      if (selectedClass?.id !== item.id) {
        setSelectedClass(item);
        setSelectedSession(null); // Reset session
      }
    } else if (modalType === 'session') {
      setSelectedSession(item);
      if (!selectedClass && item.course_class) {
        // Tự động set lớp nếu ca học có thông tin lớp
        const c = classes.find(c => c.id === item.course_class.id);
        if (c) setSelectedClass(c);
      }
    }
    setModalVisible(false);
  };

  const clearSelection = (type) => {
    if (type === 'class') {
      setSelectedClass(null);
      setSelectedSession(null);
    } else {
      setSelectedSession(null);
    }
  };

  const renderModalItem = ({ item }) => {
    if (modalType === 'class') {
      return (
        <AppPressable style={styles.modalItem} onPress={() => handleSelectOption(item)} scaleEnabled={false}>
          <Text style={styles.modalItemTitle}>{item.class_name}</Text>
          <Text style={styles.modalItemSub}>{item.class_code}</Text>
        </AppPressable>
      );
    } else {
      return (
        <AppPressable style={styles.modalItem} onPress={() => handleSelectOption(item)} scaleEnabled={false}>
          <Text style={styles.modalItemTitle}>
            {item.subject?.subject_name} ({item.course_class?.class_name})
          </Text>
          <Text style={styles.modalItemSub}>
            {formatDateStr(item.study_date)} • Tiết {item.lesson_start}-{item.lesson_end}
          </Text>
        </AppPressable>
      );
    }
  };

  const COLLAPSE_THRESHOLD = 150;

  const handleScroll = (event) => {
    const y = event.nativeEvent.contentOffset.y;
    if (y >= COLLAPSE_THRESHOLD && !isFilterCollapsed) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsFilterCollapsed(true);
      setIsFilterManuallyExpanded(false);
    }
  };

  const openDatePicker = (field) => {
    setActiveDateField(field);
    setTempDate(field === 'from' ? startDate : endDate);
    setShowDatePicker(true);
  };

  const confirmDate = () => {
    if (activeDateField === 'from') {
      setStartDate(tempDate);
      if (tempDate > endDate) {
        setEndDate(tempDate);
      }
    }
    if (activeDateField === 'to') {
      if (tempDate < startDate) {
        Alert.alert('Lỗi', 'Đến ngày không được nhỏ hơn Từ ngày.');
      } else {
        setEndDate(tempDate);
      }
    }
    setSelectedSession(null);
    setShowDatePicker(false);
    setActiveDateField(null);
  };

  const handleAndroidDateChange = (event, selectedDate) => {
    setShowDatePicker(false);

    if (event.type === 'dismissed') {
      setActiveDateField(null);
      return;
    }

    if (selectedDate) {
      if (activeDateField === 'from') {
        setStartDate(selectedDate);
        if (selectedDate > endDate) {
          setEndDate(selectedDate);
        }
      }
      if (activeDateField === 'to') {
        if (selectedDate < startDate) {
          Alert.alert('Lỗi', 'Đến ngày không được nhỏ hơn Từ ngày.');
        } else {
          setEndDate(selectedDate);
        }
      }
      setSelectedSession(null);
    }
    setActiveDateField(null);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Lịch sử" subtitle="Báo cáo điểm danh chi tiết" />

      {/* ── Filter Area ─────────────────────────────────────────────────────── */}
      <View style={styles.filterContainer}>
        {isFilterCollapsed ? (
          <AppPressable 
            style={styles.collapsedFilterCard} 
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIsFilterCollapsed(false);
              setIsFilterManuallyExpanded(true);
            }}
            scaleTo={0.98}
          >
            <Search size={16} color={colors.primary} />
            <Text style={styles.collapsedFilterText} numberOfLines={1}>
              Bộ lọc
            </Text>
            <ChevronDown size={18} color={colors.primary} />
          </AppPressable>
        ) : (
          <View style={styles.filterCard}>
            {/* Filter Header with Manual Collapse */}
            <View style={styles.filterCardHeader}>
              <Text style={styles.filterCardTitle}>Bộ lọc tra cứu</Text>
              <AppPressable 
                style={styles.collapseBtn}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setIsFilterCollapsed(true);
                  setIsFilterManuallyExpanded(false);
                }}
                scaleEnabled={false}
              >
                <ChevronUp size={20} color={colors.primary} />
              </AppPressable>
            </View>

            {/* Date Row */}
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <Text style={styles.filterLabel}>Từ ngày</Text>
                <AppPressable style={styles.dropdownBtn} onPress={() => openDatePicker('from')} scaleTo={0.98}>
                  <Calendar size={15} color={colors.primary} />
                  <Text style={styles.dropdownText}>{formatDateStr(startDate)}</Text>
                </AppPressable>
              </View>
              <View style={{ width: 10 }} />
              <View style={styles.dateCol}>
                <Text style={styles.filterLabel}>Đến ngày</Text>
                <AppPressable style={styles.dropdownBtn} onPress={() => openDatePicker('to')} scaleTo={0.98}>
                  <Calendar size={15} color={colors.primary} />
                  <Text style={styles.dropdownText}>{formatDateStr(endDate)}</Text>
                </AppPressable>
              </View>
            </View>

            {/* Class Row */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Lớp học</Text>
              <View style={styles.dropdownWrap}>
                <AppPressable style={styles.dropdownBtnFill} onPress={openClassModal} scaleTo={0.98}>
                  <Text style={selectedClass ? styles.dropdownTextFill : styles.dropdownPlaceholder}>
                    {selectedClass ? `${selectedClass.class_name} - ${selectedClass.class_code}` : 'Tất cả lớp học'}
                  </Text>
                  <ChevronDown size={18} color={colors.textMuted} />
                </AppPressable>
                {selectedClass && (
                  <AppPressable style={styles.clearBtn} onPress={() => clearSelection('class')} scaleEnabled={false}>
                    <X size={16} color={colors.danger} />
                  </AppPressable>
                )}
              </View>
            </View>

            {/* Session Row */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Ca học</Text>
              <View style={styles.dropdownWrap}>
                <AppPressable style={styles.dropdownBtnFill} onPress={openSessionModal} scaleTo={0.98}>
                  <Text style={selectedSession ? styles.dropdownTextFill : styles.dropdownPlaceholder} numberOfLines={1}>
                    {selectedSession 
                      ? `${selectedSession.subject?.subject_name} - ${formatDateStr(selectedSession.study_date)}`
                      : 'Tất cả ca học'}
                  </Text>
                  <ChevronDown size={18} color={colors.textMuted} />
                </AppPressable>
                {selectedSession && (
                  <AppPressable style={styles.clearBtn} onPress={() => clearSelection('session')} scaleEnabled={false}>
                    <X size={16} color={colors.danger} />
                  </AppPressable>
                )}
              </View>
            </View>

            <AppPressable style={styles.searchBtn} onPress={fetchHistory} disabled={loading} scaleTo={0.97}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Search size={16} color="#fff" />}
              <Text style={styles.searchBtnText}>Tra cứu</Text>
            </AppPressable>
          </View>
        )}
      </View>

      {/* Date pickers */}
      {Platform.OS === 'ios' && showDatePicker && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.datePickerOverlay}>
            <View style={styles.datePickerModal}>
              <View style={styles.datePickerHeader}>
                <AppPressable onPress={() => setShowDatePicker(false)} scaleEnabled={false}>
                  <Text style={styles.datePickerCancelText}>Hủy</Text>
                </AppPressable>

                <Text style={styles.datePickerTitle}>
                  {activeDateField === 'from' ? 'Chọn từ ngày' : 'Chọn đến ngày'}
                </Text>

                <AppPressable onPress={confirmDate} scaleEnabled={false}>
                  <Text style={styles.datePickerDoneText}>Xong</Text>
                </AppPressable>
              </View>

              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={(event, selectedDate) => {
                  if (selectedDate) {
                    setTempDate(selectedDate);
                  }
                }}
              />
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="calendar"
          onChange={handleAndroidDateChange}
        />
      )}

      {/* Modal Selection */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chọn {modalType === 'class' ? 'Lớp học' : 'Ca học'}</Text>
              <AppPressable onPress={() => setModalVisible(false)} scaleEnabled={false}><X size={24} color={colors.text} /></AppPressable>
            </View>
            {modalLoading ? (
              <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />
            ) : modalData.length === 0 ? (
              <Text style={styles.modalEmpty}>Không có dữ liệu</Text>
            ) : (
              <FlatList
                data={modalData}
                keyExtractor={(item) => item.id.toString() + (item.study_date || '')}
                renderItem={renderModalItem}
                style={{ maxHeight: 400 }}
              />
            )}
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Đang tải...</Text>
          </View>
        ) : groupedHistory.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🗓️</Text>
            <Text style={styles.emptyTitle}>Không có dữ liệu</Text>
            <Text style={styles.emptySubtitle}>Không tìm thấy ca học nào thỏa mãn điều kiện lọc.</Text>
          </View>
        ) : (
          groupedHistory.map((group, index) => {
            const groupId = `${group.session.id}_${group.session.study_date}`;
            return (
              <AttendanceSubjectCard 
                key={groupId}
                group={group}
                isExpanded={expandedGroupId === groupId}
                onToggle={() => toggleGroup(groupId)}
              />
            );
          })
        )}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Filter Area
  filterContainer: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  collapsedFilterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  collapsedFilterText: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  filterCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  filterCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  filterCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.1,
  },
  collapseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 20,
  },
  filterLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textSecondary,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  dateRow: { flexDirection: 'row', marginBottom: spacing.md },
  dateCol: { flex: 1 },
  filterRow: { marginBottom: spacing.md },
  
  dropdownWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.background, padding: 10,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  dropdownBtnFill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.background, padding: 10,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  dropdownText: { fontSize: 13, color: colors.text, fontWeight: '600', flex: 1 },
  dropdownTextFill: { fontSize: 13, color: colors.text, fontWeight: '600', flex: 1 },
  dropdownPlaceholder: { fontSize: 13, color: colors.textMuted, flex: 1 },
  clearBtn: { padding: 4, backgroundColor: colors.dangerBg, borderRadius: radius.sm },

  searchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.lg,
    ...shadow.primary,
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scrollContent: { padding: spacing.md, paddingBottom: 90 },

  // Unused card styles removed, they are now in AttendanceSubjectCard


  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  modalTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  modalItem: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  modalItemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  modalItemSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  modalEmpty: { textAlign: 'center', padding: 30, color: colors.textMuted },

  loadingBox: { alignItems: 'center', padding: 40, gap: 10 },
  loadingText: { color: colors.textMuted },
  emptyBox: { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 5 },
  emptySubtitle: { color: colors.textMuted, textAlign: 'center', fontSize: 13 },

  // Date Picker Modal (iOS)
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  datePickerModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  datePickerHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F7',
  },
  datePickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },
  datePickerCancelText: {
    fontSize: 16,
    color: '#6B7280',
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
});

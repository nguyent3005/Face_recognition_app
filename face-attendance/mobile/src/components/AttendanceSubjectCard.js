import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors, spacing, radius, shadow } from '../theme';
import AppPressable from './AppPressable';

const formatConfidence = (confidence) => {
  if (confidence === null || confidence === undefined || confidence === "") {
    return "--";
  }
  const raw = Number(confidence);
  if (Number.isNaN(raw)) return "--";
  const percent = raw <= 1 ? raw * 100 : raw;
  return `${percent.toFixed(1)}%`;
};

const formatCheckTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDateStr = (d) => {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getStatusLabel = (status) => {
  switch (status) {
    case 'present':
    case 'co_mat':
    case 'Có mặt':
      return 'Có mặt';
    case 'late':
    case 'di_muon':
    case 'Đi muộn':
      return 'Đi muộn';
    case 'absent':
    case 'vang':
    case 'Vắng':
      return 'Vắng';
    default:
      return 'Chưa điểm danh';
  }
};

const getStatusBadgeStyle = (status) => {
  const label = getStatusLabel(status);
  if (label === 'Có mặt') return styles.statusPresentBadge;
  if (label === 'Đi muộn') return styles.statusLateBadge;
  if (label === 'Vắng') return styles.statusAbsentBadge;
  return styles.statusPendingBadge;
};

const getStatusTextStyle = (status) => {
  const label = getStatusLabel(status);
  if (label === 'Có mặt') return styles.statusPresentText;
  if (label === 'Đi muộn') return styles.statusLateText;
  if (label === 'Vắng') return styles.statusAbsentText;
  return styles.statusPendingText;
};

export default function AttendanceSubjectCard({ group, isExpanded, onToggle }) {
  const sess = group.session;
  const stats = group.stats;

  return (
    <View style={styles.groupCard}>
      {/* Header Ca Học */}
      <View style={styles.groupHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <BookOpen size={16} color={colors.primary} />
          <Text style={styles.groupTitle} numberOfLines={1}>{sess.subject?.subject_name}</Text>
        </View>
        <Text style={styles.groupSub}>
          {sess.course_class?.class_name} - {sess.course_class?.class_code}
        </Text>
        <Text style={styles.groupSub}>
          {sess.day_of_week}, {formatDateStr(sess.study_date)} • Tiết {sess.lesson_start}-{sess.lesson_end} • Phòng {sess.room}
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{stats.total}</Text>
          <Text style={styles.statLabel}>Sinh viên</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: colors.success }]}>{stats.present}</Text>
          <Text style={styles.statLabel}>Có mặt</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: colors.warning }]}>{stats.late}</Text>
          <Text style={styles.statLabel}>Đi muộn</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: colors.danger }]}>{stats.absent}</Text>
          <Text style={styles.statLabel}>Vắng</Text>
        </View>
      </View>

      {/* Nút Toggle */}
      <AppPressable 
        style={styles.expandButton} 
        onPress={onToggle}
        scaleEnabled={false}
      >
        <Text style={styles.expandButtonText}>
          {isExpanded ? "Ẩn danh sách sinh viên" : "Xem danh sách sinh viên"}
        </Text>
        {isExpanded ? (
          <ChevronUp size={16} color={colors.primary} />
        ) : (
          <ChevronDown size={16} color={colors.primary} />
        )}
      </AppPressable>

      {/* Danh sách sinh viên (chỉ render nếu isExpanded === true) */}
      {isExpanded && (
        <View style={styles.studentListContainer}>
          {group.students.length === 0 ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>Không có sinh viên trong lớp học này</Text>
            </View>
          ) : (
            group.students.map((std, index) => {
              return (
                <View key={std.student_id || std.id} style={styles.studentItemWrapper}>
                  <View style={styles.studentItem}>
                    <View style={styles.studentInfo}>
                      <Text 
                        style={styles.studentName} 
                        numberOfLines={2} 
                        ellipsizeMode="tail"
                      >
                        {std.full_name}
                      </Text>
                      <Text style={styles.studentId}>
                        ({std.student_code || std.student_id || std.id})
                      </Text>
                    </View>

                    <View style={styles.studentStatusWrapper}>
                      <View style={[styles.statusBadge, getStatusBadgeStyle(std.status)]}>
                        <Text style={[styles.statusText, getStatusTextStyle(std.status)]}>
                          {getStatusLabel(std.status)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {index < group.students.length - 1 && (
                    <View style={styles.studentSeparator} />
                  )}
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  groupCard: {
    backgroundColor: '#F8FAFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#DCE4F2',
    padding: 20,
    marginBottom: 20,
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#8EA4C8',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 16,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  groupHeader: {
    marginBottom: 4,
  },
  groupTitle: { fontSize: 16, fontWeight: '800', color: colors.primary, flex: 1 },
  groupSub: { fontSize: 13, color: colors.textSecondary, marginTop: 4, fontWeight: '500' },

  statsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7ECF5',
    flexDirection: 'row',
    paddingVertical: 18,
    paddingHorizontal: 12,
    marginTop: 16,
    marginBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#B5C2D8',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },

  expandButton: {
    marginTop: 4,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  expandButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },

  studentListContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#EEF1F5',
  },
  emptyList: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyListText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  studentItemWrapper: {
    flexDirection: 'column',
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  studentInfo: {
    flex: 1,
    paddingRight: 12,
    minWidth: 0,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 22,
  },
  studentId: {
    marginTop: 4,
    fontSize: 14,
    color: '#98A2B3',
    fontWeight: '500',
  },
  studentStatusWrapper: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    maxWidth: 140,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusPresentBadge: { backgroundColor: '#EAFBF3' },
  statusPresentText: { color: '#12B76A' },
  statusLateBadge: { backgroundColor: '#FFF4E5' },
  statusLateText: { color: '#F59E0B' },
  statusAbsentBadge: { backgroundColor: '#FEECEC' },
  statusAbsentText: { color: '#EF4444' },
  statusPendingBadge: { backgroundColor: '#EEF2F7' },
  statusPendingText: { color: '#667085' },
  studentSeparator: {
    height: 1,
    backgroundColor: '#EEF1F5',
    marginHorizontal: 16,
  },
});

<script setup lang="ts">
import Headbar from './blocks/headbar.vue';
</script>
<style src="./style.css" />
<template>
  <div>
    <!-- <NuxtRouteAnnouncer /> -->
    <Headbar />
    <mybody>
      <RouterView />
    </mybody>
  </div>
</template>

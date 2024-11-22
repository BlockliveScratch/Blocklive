<script setup lang=ts>
    defineProps<{name:string, perks:string[], price:number}>()
</script>
<template>

    <div class="option">
        <span class="optionName">{{ name }}</span>
        <div class="optionPerks">
            <span class="price">${{ price }}</span> per month
            <span class="optionPerk" v-for="perk in perks"> + {{ perk }} </span>
        </div>
    </div>

</template>

<style src="./options.css"/>